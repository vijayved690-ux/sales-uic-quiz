const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const cron = require('node-cron');
const puppeteer = require('puppeteer');

// ===== GOOGLE CREDS =====
const creds = require('./google-creds.json');

// ===== WHATSAPP CLIENT =====
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ===== CONFIG =====
const MANAGER_PHONE = '9198XXXXXXXX@c.us';
const SHEET_ID = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';

const buddies = [
    { name: 'AMAN DESAI', phone: '9198XXXXXXXX@c.us' },
    { name: 'ARPIT PATEL', phone: '9198XXXXXXXX@c.us' },
    { name: 'CHETAN TUSHAVARA', phone: '9198XXXXXXXX@c.us' },
    { name: 'JITENDRA MEHTA', phone: '9198XXXXXXXX@c.us' },
    { name: 'NISHAL CHOKSI', phone: '9198XXXXXXXX@c.us' },
    { name: 'PRASHANT GARANGE', phone: '9198XXXXXXXX@c.us' },
    { name: 'SHAHEBAJ SHAIKH', phone: '9198XXXXXXXX@c.us' },
    { name: 'YOGESH SOLANKI', phone: '9198XXXXXXXX@c.us' }
];

// ===== QUESTIONS =====
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

// ===== QR =====
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Scan QR using WhatsApp Linked Devices');
});

// ===== READY =====
client.on('ready', async () => {
    console.log('✅ Bot Ready');
    await initSheet();
    scheduleDailyMIS();
    scheduleReminder();
    scheduleSummary();
});

// ===== MESSAGE FLOW =====
client.on('message', async msg => {
    const phone = msg.from;
    const buddy = buddies.find(b => b.phone === phone);

    if (!buddy || msg.fromMe) return;

    if (!userState[phone]) {
        userState[phone] = {
            step: 0,
            answers: [],
            name: buddy.name,
            completed: false
        };
    }

    const state = userState[phone];

    if (state.completed) {
        await msg.reply('✅ Today MIS already submitted.');
        return;
    }

    if (state.step > 0) {
        state.answers[state.step - 1] = msg.body.trim();
    }

    if (state.step < questions.length) {
        await client.sendMessage(phone, questions[state.step]);
        state.step++;
    } else {
        await client.sendMessage(phone, '✅ MIS submitted successfully.');
        await saveToSheet(state.name, state.answers);
        state.completed = true;
    }
});

// ===== GOOGLE SHEET =====
async function initSheet() {
    doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    console.log('✅ Google Sheet Connected');
}

async function saveToSheet(name, answers) {
    const sheet = doc.sheetsByIndex[0];

    await sheet.addRow({
        Timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
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

    console.log(`Saved MIS for ${name}`);
}

// ===== DAILY MIS =====
function scheduleDailyMIS() {
    cron.schedule('0 19 * * *', () => {
        console.log('📊 Sending Daily MIS');

        buddies.forEach(async b => {
            userState[b.phone] = {
                step: 0,
                answers: [],
                name: b.name,
                completed: false
            };

            await client.sendMessage(
                b.phone,
                `Hi ${b.name}, Daily MIS Time 📊\n\n${questions[0]}`
            );

            userState[b.phone].step = 1;
        });

    }, { timezone: "Asia/Kolkata" });
}

// ===== REMINDER =====
function scheduleReminder() {
    cron.schedule('0 21 * * *', () => {

        buddies.forEach(async b => {
            const state = userState[b.phone];

            if (state && !state.completed && state.step > 0) {
                await client.sendMessage(
                    b.phone,
                    `⏰ Reminder: MIS Pending\n\nNext Question:\n${questions[state.step - 1]}`
                );
            }
        });

    }, { timezone: "Asia/Kolkata" });
}

// ===== SUMMARY =====
function scheduleSummary() {
    cron.schedule('30 22 * * *', async () => {

        let completed = 0;
        let totalMinus = 0;

        let summary = `*UIC Buddy MIS Summary – ${new Date().toLocaleDateString('en-IN')}*\n\n`;

        for (const b of buddies) {
            const state = userState[b.phone];

            if (state && state.completed) {
                completed++;

                const minus = parseInt(state.answers[1]) || 0;
                totalMinus += minus;

                summary += `✅ ${b.name}: Target ${state.answers[0]}, Minus Visited ${minus}\n`;
            } else {
                summary += `❌ ${b.name}: No Response\n`;
            }
        }

        summary += `\n*Total Submitted: ${completed}/8*`;
        summary += `\n*Total Minus Doctors Visited: ${totalMinus}*`;

        await client.sendMessage(MANAGER_PHONE, summary);

        console.log('✅ Summary Sent');
    }, { timezone: "Asia/Kolkata" });
}

// ===== START =====
client.initialize();
