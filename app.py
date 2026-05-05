from flask import Flask, request, jsonify, render_template, send_file
from flask_socketio import SocketIO, emit
from pymongo import MongoClient
import requests
import pandas as pd
import io
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'uic_ultra_secret'
socketio = SocketIO(app, cors_allowed_origins="*")

# MongoDB Connection
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
client = MongoClient(MONGO_URI)
db = client['uic_assessment_db']
users_col = db['users']         
questions_col = db['questions'] 
answers_col = db['answers']     
sessions_col = db['sessions']   

# WATI API Credentials
WATI_API_ENDPOINT = os.getenv("WATI_API_ENDPOINT", "https://your-wati-endpoint.wati.io")
WATI_TOKEN = os.getenv("WATI_TOKEN", "your_wati_token")

headers = {
    "Authorization": f"Bearer {WATI_TOKEN}",
    "Content-Type": "application/json"
}

def send_wati_message(phone, text):
    url = f"{WATI_API_ENDPOINT}/api/v1/sendSessionMessage/{phone}"
    payload = {"messageText": text}
    requests.post(url, headers=headers, json=payload)

@app.route('/')
def dashboard():
    return render_template('index.html')

# Storage Stats
@app.route('/storage_stats', methods=['GET'])
def storage_stats():
    try:
        stats = db.command("dbstats")
        used_mb = round(stats.get('dataSize', 0) / (1024 * 1024), 4)
        total_limit_mb = 512.0
        percent_used = round((used_mb / total_limit_mb) * 100, 4)
        return jsonify({"status": "success", "used_mb": used_mb, "free_mb": round(total_limit_mb - used_mb, 4), "total_mb": total_limit_mb, "percent_used": percent_used})
    except:
        return jsonify({"status": "error", "message": "Stats error"})

# Question Management APIs
@app.route('/add_question', methods=['POST'])
def add_question():
    data = request.json
    questions_col.insert_one({"role": data['role'], "question_text": data['question_text'], "order": int(data['order'])})
    return jsonify({"status": "success", "message": "Question added!"})

@app.route('/get_questions', methods=['GET'])
def get_questions():
    qs = list(questions_col.find({}, {"_id": 0}).sort("order", 1))
    return jsonify(qs)

@app.route('/add_user', methods=['POST'])
def add_user():
    data = request.json
    users_col.insert_one({"name": data['name'], "phone": data['phone'], "role": data['role']})
    return jsonify({"status": "success", "message": f"{data['name']} added!"})

@app.route('/trigger_exam', methods=['POST'])
def trigger_exam():
    users = users_col.find()
    for user in users:
        url = f"{WATI_API_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber={user['phone']}"
        payload = {"template_name": "daily_exam_start", "broadcast_name": "uic_trigger", "parameters": [{"name": "1", "value": user['name']}]}
        requests.post(url, headers=headers, json=payload)
    return jsonify({"status": "success", "message": "Templates sent!"})

@app.route('/wati_webhook', methods=['POST'])
def wati_webhook():
    data = request.json
    sender_phone = data.get('waId')
    incoming_text = data.get('text', '').strip()
    user = users_col.find_one({"phone": sender_phone})
    if not user: return "User not found", 404
    session = sessions_col.find_one({"phone": sender_phone})
    
    if incoming_text.upper() == 'START':
        questions = list(questions_col.find({"role": user['role']}).sort("order", 1))
        total_q = len(questions)
        sessions_col.update_one({"phone": sender_phone}, {"$set": {"current_q_index": 0, "role": user['role'], "total_q": total_q}}, upsert=True)
        if total_q > 0:
            send_wati_message(sender_phone, f"📝 *Q 1/{total_q}:* {questions[0]['question_text']}")
            socketio.emit('live_update', {'msg': f"🟢 {user['name']} started."})
        return "OK", 200

    if session:
        idx = session.get('current_q_index', 0)
        total = session.get('total_q', 0)
        questions = list(questions_col.find({"role": user['role']}).sort("order", 1))
        if idx < len(questions):
            answers_col.insert_one({"name": user['name'], "role": user['role'], "question": questions[idx]['question_text'], "answer": incoming_text})
            socketio.emit('live_update', {'msg': f"📝 {user['name']} (Q {idx+1}): {incoming_text}"})
            next_idx = idx + 1
            if next_idx < len(questions):
                sessions_col.update_one({"phone": sender_phone}, {"$set": {"current_q_index": next_idx}})
                send_wati_message(sender_phone, f"📝 *Q {next_idx+1}/{total}:* {questions[next_idx]['question_text']}")
            else:
                sessions_col.delete_one({"phone": sender_phone})
                send_wati_message(sender_phone, "✅ *Dhanyawad!* Reporting complete.")
                socketio.emit('live_update', {'msg': f"✅ {user['name']} finished."})
    return "OK", 200

@app.route('/send_announcement', methods=['POST'])
def send_announcement():
    msg = request.json.get('message', '')
    users = users_col.find()
    for user in users:
        url = f"{WATI_API_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber={user['phone']}"
        payload = {"template_name": "team_announcement", "parameters": [{"name": "1", "value": user['name']}, {"name": "2", "value": msg}]}
        requests.post(url, headers=headers, json=payload)
    return jsonify({"status": "success", "message": "Broadcasted!"})

@app.route('/export_excel', methods=['GET'])
def export_excel():
    all_ans = list(answers_col.find({}, {"_id": 0}))
    if not all_ans: return "No data", 400
    df = pd.DataFrame(all_ans)
    pivot_df = df.pivot_table(index='question', columns='name', values='answer', aggfunc='first')
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        pivot_df.to_excel(writer, sheet_name='Results')
    output.seek(0)
    return send_file(output, download_name="UIC_Report.xlsx", as_attachment=True)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000)
