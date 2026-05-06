const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./google-creds.json');
const cron = require('node-cron');
const express = require('express');

// --- RENDER DUMMY SERVER (To keep it alive) ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is active! Scan QR in Logs.'));
app.listen(port, () => console.log(`Server listening on port ${port}`));

// --- WHATSAPP CLIENT SETUP ---
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ] 
    }
});

// ===== CONFIG - FILL YOUR DATA HERE =====
const MANAGER_PHONE = '91XXXXXXXXXX@c.us'; // Manager's number
const SHEET_ID = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';

const buddies = [
    { name: 'AMAN DESAI', phone: '91XXXXXXXXXX@c.us' },
    { name: 'ARPIT PATEL', phone: '91XXXXXXXXXX@c.us' },
    { name: 'CHETAN TUSHAVARA', phone: '91XXXXXXXXXX@c.us' },
    { name: 'JITENDRA MEHTA', phone: '91XXXXXXXXXX@c.us' },
    { name: 'NISHAL CHOKSI', phone: '91XXXXXXXXXX@c.us' },
    { name: 'PRASHANT GARANGE', phone: '91XXXXXXXXXX@c.us' },
    { name: 'SHAHEBAJ SHAIKH', phone: '91XXXXXXXXXX@c.us' },
    { name: 'YOGESH SOLANKI', phone: '91XXXXXXXXXX@c.us' }
];
// ========================================

const questions = [
    "1) What's your May 26 target?",
    "2) How many minus doctors have you visited till today?",
    "3) Will you be able to complete your full doctor list visits this month? Yes/No",
    "4) What is your Call_Average?",
    "5) When will you complete minus 30 list? Give date DD/MM",
    "6) What is your strategy for achieve target?",
    "7) How many new dr you will add this month?",
    "8) Do you have any lead for corporate-tieup? Yes/No + Company name",
    "9) Do you have Any suggestion or Idea to grow UIC Business?"
];

let userState = {}; 
let doc; 

client.on('qr', qr => {
    qrcode.generate(qr, {small: true});
    console.log('--- SCAN THIS QR IN RENDER LOGS ---');
});

client.on('ready', async () => {
    console.log('✅ MIS Bot Ready at', new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'}));
    await initSheet();
    scheduleDailyMIS();
    scheduleReminder();
    scheduleSummary();
});

client.on('message', async msg => {
    const phone = msg.from;
    const buddy = buddies.find(b => b.phone === phone);
    if (!buddy || msg.fromMe) return;

    if (!userState[phone]) userState[phone] = { step: 0, answers: [], name: buddy.name, completed: false };
    const state = userState[phone];

    if (state.completed) {
        await msg.reply('Today\'s MIS already submitted ✅. See you tomorrow 7 PM.');
        return;
    }

    if (state.step > 0) {
        state.answers[state.step - 1] = msg.body.trim();
    }

    if (state.step < questions.length) {
        await client.sendMessage(phone, questions[state.step]);
        state.step++;
    } else {
        await client.sendMessage(phone, '✅ Done! All 9 answers submitted. Thank you.\n\nSummary will be sent to management at 10:30 PM.');
        await saveToSheet(state.name, state.answers);
        state.completed = true;
    }
});

async function initSheet() {
    try {
        doc = new GoogleSpreadsheet(SHEET_ID);
        await doc.useServiceAccountAuth(creds);
        await doc.loadInfo();
        console.log('Connected to Sheet:', doc.title);
    } catch (e) {
        console.error('Sheet Auth Error:', e);
    }
}

async function saveToSheet(name, answers) {
    const sheet = doc.sheetsByIndex[0];
    await sheet.addRow({
        Timestamp: new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'}),
        Buddy: name,
        Q1_Target: answers[0] || '',
        Q2_MinusVisited: answers[1] || '',
        Q3_CompleteList: answers[2] || '',
        Q4_CallAvg: answers[3] || '',
        Q5_Minus30Date: answers[4] || '',
        Q6_Strategy: answers[5] || '',
        Q7_NewDr: answers[6] || '',
        Q8_CorporateLead: answers[7] || '',
        Q9_Suggestion: answers[8] || ''
    });
}

function scheduleDailyMIS() {
    cron.schedule('0 19 * * *', () => {
        buddies.forEach(async b => {
            userState[b.phone] = { step: 0, answers: [], name: b.name, completed: false };
            await client.sendMessage(b.phone, `Hi ${b.name}, Daily MIS time 📊\n\n${questions[0]}`);
            userState[b.phone].step = 1;
        });
    }, { timezone: "Asia/Kolkata" });
}

function scheduleReminder() {
    cron.schedule('0 21 * * *', () => {
        buddies.forEach(async b => {
            const state = userState[b.phone];
            if (state && !state.completed && state.step > 0) {
                await client.sendMessage(b.phone, `⏰ Reminder: Please complete remaining questions.\n\nNext: ${questions[state.step-1]}`);
            }
        });
    }, { timezone: "Asia/Kolkata" });
}

function scheduleSummary() {
    cron.schedule('30 22 * * *', async () => {
        let completedCount = 0;
        let summary = `*UIC Buddy MIS Summary – ${new Date().toLocaleDateString('en-IN')}*\n\n`;
        buddies.forEach(b => {
            const state = userState[b.phone];
            if (state && state.completed) {
                completedCount++;
                summary += `✅ ${b.name}: Submitted\n`;
            } else {
                summary += `❌ ${b.name}: No Response\n`;
            }
        });
        summary += `\nTotal: ${completedCount}/${buddies.length} submitted.`;
        await client.sendMessage(MANAGER_PHONE, summary);
    }, { timezone: "Asia/Kolkata" });
}

client.initialize();
