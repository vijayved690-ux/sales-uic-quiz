from flask import Flask, request, jsonify, render_template, send_file
from flask_socketio import SocketIO, emit
from pymongo import MongoClient
import requests
import pandas as pd
import io
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_super_secret_key'
socketio = SocketIO(app, cors_allowed_origins="*")

# MongoDB Connection (Use MongoDB Atlas Cloud URI here so data never deletes on deployment)
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
client = MongoClient(MONGO_URI)
db = client['sales_exam_db']
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

# API: Database Storage Stats
@app.route('/storage_stats', methods=['GET'])
def storage_stats():
    try:
        stats = db.command("dbstats")
        # Convert bytes to Megabytes (MB)
        data_size_mb = stats.get('dataSize', 0) / (1024 * 1024)
        
        # MongoDB Atlas Free Tier Limit is 512 MB
        total_limit_mb = 512.0
        used_mb = round(data_size_mb, 4)
        free_mb = round(total_limit_mb - used_mb, 4)
        percent_used = round((used_mb / total_limit_mb) * 100, 4)

        return jsonify({
            "status": "success",
            "used_mb": used_mb,
            "free_mb": free_mb,
            "total_mb": total_limit_mb,
            "percent_used": percent_used
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

# API: Add Team Member
@app.route('/add_user', methods=['POST'])
def add_user():
    data = request.json
    users_col.insert_one({"name": data['name'], "phone": data['phone'], "role": data['role']})
    return jsonify({"status": "success", "message": f"{data['name']} added successfully!"})

# API: Trigger Exam manually for everyone
@app.route('/trigger_exam', methods=['POST'])
def trigger_exam():
    users = users_col.find()
    for user in users:
        url = f"{WATI_API_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber={user['phone']}"
        payload = {
            "template_name": "daily_exam_start",
            "broadcast_name": "exam_trigger",
            "parameters": [{"name": "1", "value": user['name']}]
        }
        requests.post(url, headers=headers, json=payload)
    return jsonify({"status": "success", "message": "Exam templates sent to all users."})

# API: Handle WhatsApp Replies (WATI Webhook)
@app.route('/wati_webhook', methods=['POST'])
def wati_webhook():
    data = request.json
    sender_phone = data.get('waId')
    incoming_text = data.get('text', '').strip()

    user = users_col.find_one({"phone": sender_phone})
    if not user:
        return "User not found", 404

    session = sessions_col.find_one({"phone": sender_phone})
    
    if incoming_text.upper() == 'START':
        sessions_col.update_one(
            {"phone": sender_phone},
            {"$set": {"current_q_index": 0, "role": user['role']}},
            upsert=True
        )
        questions = list(questions_col.find({"role": user['role']}).sort("order", 1))
        if questions:
            send_wati_message(sender_phone, f"Q1: {questions[0]['question_text']}")
            socketio.emit('live_update', {'msg': f"🟢 {user['name']} started the exam."})
        return "Started", 200

    if session:
        current_index = session.get('current_q_index', 0)
        questions = list(questions_col.find({"role": user['role']}).sort("order", 1))
        
        if current_index < len(questions):
            current_q = questions[current_index]
            
            # Save the answer
            answers_col.insert_one({
                "phone": sender_phone,
                "name": user['name'],
                "role": user['role'],
                "question": current_q['question_text'],
                "answer": incoming_text
            })
            
            socketio.emit('live_update', {'msg': f"📝 {user['name']} answered: {current_q['question_text']}"})

            next_index = current_index + 1
            if next_index < len(questions):
                sessions_col.update_one({"phone": sender_phone}, {"$set": {"current_q_index": next_index}})
                send_wati_message(sender_phone, f"Q{next_index+1}: {questions[next_index]['question_text']}")
            else:
                sessions_col.delete_one({"phone": sender_phone})
                send_wati_message(sender_phone, "Thank you! Aapke sabhi answers record ho gaye hain.")
                socketio.emit('live_update', {'msg': f"✅ {user['name']} completed the exam."})
                
    return "OK", 200

# API: Export to Excel
@app.route('/export_excel', methods=['GET'])
def export_excel():
    all_answers = list(answers_col.find())
    df = pd.DataFrame(all_answers)
    
    if df.empty:
        return "No data to export", 400
        
    pivot_df = df.pivot_table(index='question', columns='name', values='answer', aggfunc='first')
    
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        pivot_df.to_excel(writer, sheet_name='Exam_Results')
    
    output.seek(0)
    return send_file(output, download_name="WhatsApp_Exam_Report.xlsx", as_attachment=True)

# API: Send Custom Announcement
@app.route('/send_announcement', methods=['POST'])
def send_announcement():
    data = request.json
    custom_message = data.get('message', '')
    
    if not custom_message:
        return jsonify({"status": "error", "message": "Message cannot be empty"}), 400

    users = users_col.find()
    for user in users:
        url = f"{WATI_API_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber={user['phone']}"
        payload = {
            "template_name": "team_announcement",
            "broadcast_name": "team_update",
            "parameters": [
                {"name": "1", "value": user['name']},
                {"name": "2", "value": custom_message}
            ]
        }
        requests.post(url, headers=headers, json=payload)
        
    return jsonify({"status": "success", "message": "Announcement sent to all members!"})

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
