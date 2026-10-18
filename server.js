require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { beginCell, Address } = require('@ton/core');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "Raihan3110";
const CONFIG_FILE = path.join(__dirname, 'system-config.json');

let systemConfig = {
    adminMasterWallet: process.env.ADMIN_WALLET || "UQCul5GCA1kYB8Mvp-dLtLTp8tnxgNzuYYwhS-jFY5PNfQQE",
    toncenterApiKey: process.env.TONCENTER_API_KEY || "c25daab1896cfdef11073094a586f7c2cafd83caf21f505e203ad6ec0e726210",
    robiJettonMaster: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
    targetSupplyPool: 10000000, 
    pphPointEquivalent: 50,     
    vipMultiplier: 3.0,         
    conversionLocked: true,     
    withdrawLocked: true        
};

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        systemConfig = { ...systemConfig, ...saved };
    } catch (e) {
        console.error("Gagal membaca system-config.json:", e.message);
    }
}

function saveConfigToDisk() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(systemConfig, null, 2), 'utf-8');
}

let labCardsCatalog = [
    { id: 'c1', category: 'kimia', name: 'Tabung Reaksi Oranye', icon: '🧪', baseCost: 500, basePph: 150, currency: 'POINTS' },
    { id: 'c2', category: 'kimia', name: 'Mikroskop Elektron', icon: '🔬', baseCost: 1500, basePph: 400, currency: 'POINTS' },
    { id: 'r1', category: 'robotika', name: 'Buku Catatan Saku', icon: '📒', baseCost: 1000, basePph: 280, currency: 'POINTS' },
    { id: 'r2', category: 'robotika', name: 'Antena Pemancar', icon: '📡', baseCost: 3000, basePph: 850, currency: 'POINTS' },
    { id: 'v1', category: 'vip', name: 'Kloning Asisten Robi', icon: '🤖', baseCost: 1.5, basePph: 25000, currency: 'TON' },
    { id: 'v2', category: 'vip', name: 'Pabrik Antimateri', icon: '🌌', baseCost: 3.0, basePph: 65000, currency: 'TON' },
    { id: 'v3', category: 'vip', name: 'Stasiun Riset Orbit', icon: '🛸', baseCost: 5.0, basePph: 150000, currency: 'TON' }
];

let missionsList = [
    { id: 'm1', title: 'Gabung Channel Telegram', reward: 5000, link: 'https://t.me/' },
    { id: 'm2', title: 'Ikuti X / Twitter Resmi', reward: 7500, link: 'https://twitter.com/' }
];

const users = {};
const claimRequests = [];
const processedTxHashes = new Set();

function getOrCreateUser(userId, username = "Ilmuwan_Robi", refId = null) {
    if (!users[userId]) {
        users[userId] = {
            id: String(userId),
            username: username,
            points: 5000,
            pph: 100,
            tapPower: 1,
            energy: 1000,
            maxEnergy: 1000,
            isVip: false,
            tonSpent: 0,
            cards: { c1: 1 },
            completedMissions: [],
            referredBy: refId && refId !== String(userId) ? String(refId) : null,
            referrals: [],
            referralPointsEarned: 0,
            customTokenOverride: null,
            customUnlock: false,
            isBanned: false,
            lastSync: Date.now()
        };

        if (refId && users[refId]) {
            users[refId].points += 10000;
            users[refId].referralPointsEarned += 10000;
            users[refId].referrals.push(String(userId));
        }
    } else {
        const now = Date.now();
        const elapsedHours = (now - users[userId].lastSync) / 3600000;
        const maxOfflineHours = users[userId].isVip ? 24 : 3;
        const effectiveHours = Math.min(elapsedHours, maxOfflineHours);

        if (effectiveHours > 0.01) {
            users[userId].points += Math.floor(effectiveHours * users[userId].pph);
            users[userId].energy = users[userId].maxEnergy;
            users[userId].lastSync = now;
        }
    }
    return users[userId];
}

function getUserRawWeight(user) {
    const baseScore = user.points + (user.pph * systemConfig.pphPointEquivalent);
    return user.isVip ? (baseScore * systemConfig.vipMultiplier) : baseScore;
}

function getGlobalAutoFitStats() {
    const allUsersList = Object.values(users);
    let totalWeightedScore = 0;
    let totalRawPoints = 0;
    let totalRawPph = 0;
    let totalTonCollected = 0;

    allUsersList.forEach(u => {
        totalWeightedScore += getUserRawWeight(u);
        totalRawPoints += u.points;
        totalRawPph += u.pph;
        totalTonCollected += (u.tonSpent || 0);
    });

    const autoFitRatio = totalWeightedScore > 0 ? (totalWeightedScore / systemConfig.targetSupplyPool) : 1;
    return { totalWeightedScore, totalRawPoints, totalRawPph, totalTonCollected: +totalTonCollected.toFixed(2), autoFitRatio: +autoFitRatio.toFixed(4) };
}

function calculateFinalRobiTokens(user, precomputedRatio = null) {
    if (user.customTokenOverride !== null && user.customTokenOverride !== undefined) return Number(user.customTokenOverride);
    const ratio = precomputedRatio || getGlobalAutoFitStats().autoFitRatio;
    if (ratio <= 0) return 0;
    return Math.floor(getUserRawWeight(user) / ratio);
}

app.post('/api/user/sync', (req, res) => {
    const { userId, username, refId, taps } = req.body;
    const user = getOrCreateUser(userId, username, refId);

    if (user.isBanned) return res.status(403).json({ error: "Akun Anda telah dibekukan oleh Admin." });

    if (taps && taps > 0) {
        const validTaps = Math.min(taps, user.energy);
        user.points += validTaps * user.tapPower;
        user.energy = Math.max(0, user.energy - validTaps);
        user.lastSync = Date.now();
    }

    const isConversionOpenForUser = !systemConfig.conversionLocked || user.customUnlock === true;
    const stats = getGlobalAutoFitStats();

    res.json({
        user,
        estimatedRobiTokens: isConversionOpenForUser ? calculateFinalRobiTokens(user, stats.autoFitRatio) : null,
        lockStatus: { conversionLocked: !isConversionOpenForUser, withdrawLocked: !( !systemConfig.withdrawLocked || user.customUnlock === true ) },
        config: { adminMasterWallet: systemConfig.adminMasterWallet, ratioDivider: isConversionOpenForUser ? stats.autoFitRatio : null, vipMultiplier: systemConfig.vipMultiplier },
        catalog: labCardsCatalog,
        missions: missionsList
    });
});

app.post('/api/user/upgrade-points', (req, res) => {
    const { userId, cardId } = req.body;
    const user = getOrCreateUser(userId);
    const card = labCardsCatalog.find(c => c.id === cardId);

    if (!card) return res.status(400).json({ error: "Item alat lab tidak ditemukan" });

    const currentLvl = user.cards[cardId] || 0;
    const cost = Math.floor(card.baseCost * Math.pow(1.5, currentLvl));
    const pphGain = Math.floor(card.basePph * Math.pow(1.2, currentLvl));

    if (card.currency === 'POINTS') {
        if (user.points < cost) return res.status(400).json({ error: "Poin riset tidak cukup!" });
        user.points -= cost;
    }

    user.pph += pphGain;
    user.cards[cardId] = currentLvl + 1;

    const isConversionOpenForUser = !systemConfig.conversionLocked || user.customUnlock === true;
    res.json({ user, estimatedRobiTokens: isConversionOpenForUser ? calculateFinalRobiTokens(user) : null });
});

app.post('/api/user/complete-mission', (req, res) => {
    const { userId, missionId } = req.body;
    const user = getOrCreateUser(userId);
    const mission = missionsList.find(m => m.id === missionId);

    if (!mission) return res.status(400).json({ error: "Misi tidak ditemukan" });
    if (user.completedMissions.includes(missionId)) return res.status(400).json({ error: "Misi sudah diselesaikan!" });

    user.completedMissions.push(missionId);
    user.points += mission.reward;

    res.json({ user, message: `Berhasil klaim ${mission.reward} Poin Riset!` });
});

app.get('/api/ton/create-payload', (req, res) => {
    const comment = req.query.comment || "";
    const cell = beginCell().storeUint(0, 32).storeStringTail(comment).endCell();
    res.json({ payloadBoc: cell.toBoc().toString('base64') });
});

app.post('/api/user/claim-robi', (req, res) => {
    const { userId, walletAddress } = req.body;
    const user = getOrCreateUser(userId);

    const isConversionOpen = !systemConfig.conversionLocked || user.customUnlock === true;
    const isWithdrawOpen = !systemConfig.withdrawLocked || user.customUnlock === true;

    if (!isConversionOpen || !isWithdrawOpen) return res.status(403).json({ error: "🔒 Fitur Konversi & Withdraw masih dikunci oleh Admin!" });

    const tokenAmount = calculateFinalRobiTokens(user);
    if (tokenAmount < 5) return res.status(400).json({ error: "Minimal klaim adalah 5 Token $ROBI." });

    claimRequests.push({
        claimId: "CLM-" + Date.now(), userId: user.id, username: user.username, walletAddress,
        pointsSnapshot: user.points, pphSnapshot: user.pph, isVip: user.isVip, tonSpent: user.tonSpent,
        finalRobiAmount: tokenAmount, status: "PENDING"
    });

    user.points = 0;
    res.json({ message: `✅ Konversi berhasil! Klaim ${tokenAmount.toLocaleString('id-ID')} Token $ROBI masuk antrean Admin.` });
});

function verifyAdmin(req, res, next) {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) return res.status(403).json({ error: "Secret Key Admin Salah!" });
    next();
}

app.get('/api/admin/dashboard', verifyAdmin, (req, res) => {
    const stats = getGlobalAutoFitStats();
    let totalAllocatedRobi = 0, vipRobiSum = 0, freeRobiSum = 0;
    const allUsers = Object.values(users).map(u => {
        const calculatedRobi = calculateFinalRobiTokens(u, stats.autoFitRatio);
        totalAllocatedRobi += calculatedRobi;
        if (u.isVip) vipRobiSum += calculatedRobi; else freeRobiSum += calculatedRobi;
        return { ...u, rawWeight: getUserRawWeight(u), calculatedRobi };
    });
    res.json({ 
        systemConfig, 
        autoFitStats: { ...stats, totalAllocatedRobi, vipRobiSum, freeRobiSum }, 
        users: allUsers, 
        claimRequests, 
        missions: missionsList,
        catalog: labCardsCatalog 
    });
});

app.post('/api/admin/add-lab-card', verifyAdmin, (req, res) => {
    const { name, icon, baseCost, basePph, currency } = req.body;
    if (!name || baseCost === undefined || basePph === undefined) {
        return res.status(400).json({ error: "Nama, Harga Dasar, dan PPH harus diisi!" });
    }
    const newCard = {
        id: 'card_' + Date.now(),
        category: currency === 'TON' ? 'vip' : 'kimia',
        name: name.trim(),
        icon: icon ? icon.trim() : '🧪',
        baseCost: Number(baseCost),
        basePph: Number(basePph),
        currency: currency === 'TON' ? 'TON' : 'POINTS'
    };
    labCardsCatalog.push(newCard);
    res.json({ message: "Item upgrade peralatan berhasil ditambahkan!", catalog: labCardsCatalog });
});

app.post('/api/admin/delete-lab-card', verifyAdmin, (req, res) => {
    const { cardId } = req.body;
    labCardsCatalog = labCardsCatalog.filter(c => c.id !== cardId);
    res.json({ message: "Item upgrade berhasil dihapus!", catalog: labCardsCatalog });
});

app.post('/api/admin/add-mission', verifyAdmin, (req, res) => {
    const { title, reward, link } = req.body;
    if (!title || !reward) return res.status(400).json({ error: "Judul dan Hadiah harus diisi!" });
    
    const newMission = {
        id: 'm_' + Date.now(),
        title: title.trim(),
        reward: Number(reward),
        link: link ? link.trim() : 'https://t.me/'
    };
    missionsList.push(newMission);
    res.json({ message: "Misi baru berhasil ditambahkan!", missions: missionsList });
});

app.post('/api/admin/delete-mission', verifyAdmin, (req, res) => {
    const { missionId } = req.body;
    missionsList = missionsList.filter(m => m.id !== missionId);
    res.json({ message: "Misi berhasil dihapus!", missions: missionsList });
});

app.post('/api/admin/change-wallet', verifyAdmin, (req, res) => {
    const { newWalletAddress, newApiKey } = req.body;
    try { Address.parse(newWalletAddress.trim()); } catch (err) { return res.status(400).json({ error: "❌ Format Alamat Wallet TON tidak valid!" }); }
    systemConfig.adminMasterWallet = newWalletAddress.trim();
    if (newApiKey && newApiKey.trim() !== "") systemConfig.toncenterApiKey = newApiKey.trim();
    saveConfigToDisk();
    res.json({ message: `✅ Alamat Master Wallet TON berhasil diubah ke:\n${systemConfig.adminMasterWallet}`, adminMasterWallet: systemConfig.adminMasterWallet });
});

app.post('/api/admin/update-config', verifyAdmin, (req, res) => {
    if (req.body.adminMasterWallet) {
        try { Address.parse(req.body.adminMasterWallet.trim()); req.body.adminMasterWallet = req.body.adminMasterWallet.trim(); } 
        catch (err) { return res.status(400).json({ error: "❌ Format Alamat Wallet TON tidak valid!" }); }
    }
    systemConfig = { ...systemConfig, ...req.body };
    saveConfigToDisk();
    res.json({ message: "✅ Seluruh Parameter & Alamat Wallet berhasil disimpan permanen!", systemConfig });
});

app.post('/api/admin/edit-user', verifyAdmin, (req, res) => {
    const { userId, points, pph, isBanned, customTokenOverride, customUnlock } = req.body;
    const user = users[userId];
    if (!user) return res.status(404).json({ error: "Pemain tidak ditemukan" });
    if (points !== undefined) user.points = Number(points);
    if (pph !== undefined) user.pph = Number(pph);
    if (typeof isBanned === 'boolean') user.isBanned = isBanned;
    if (typeof customUnlock === 'boolean') user.customUnlock = customUnlock;
    if (customTokenOverride !== undefined) user.customTokenOverride = customTokenOverride === "" ? null : Number(customTokenOverride);
    res.json({ message: "Data pemain diperbarui", user });
});

async function checkIncomingTonTransactions() {
    if (!systemConfig.toncenterApiKey || !systemConfig.adminMasterWallet) return;
    try {
        const url = `https://toncenter.com/api/v2/getTransactions?address=${systemConfig.adminMasterWallet}&limit=15&api_key=${systemConfig.toncenterApiKey}`;
        const { data } = await axios.get(url);
        if (!data.result) return;
        for (const tx of data.result) {
            const txHash = tx.transaction_id.hash;
            if (processedTxHashes.has(txHash)) continue;
            const inMsg = tx.in_msg;
            if (!inMsg || !inMsg.value) continue;
            const amountTon = parseFloat(inMsg.value) / 1e9;
            const comment = inMsg.message || "";
            if (comment.startsWith("VIP:")) {
                const [, userId, itemId] = comment.split(":");
                const user = getOrCreateUser(userId);
                processedTxHashes.add(txHash);
                user.isVip = true;
                user.tonSpent = +(user.tonSpent + amountTon).toFixed(2);
                if (itemId === "BOOSTER_TAP") user.tapPower += 15;
                else {
                    const card = labCardsCatalog.find(c => c.id === itemId);
                    if (card) { user.cards[itemId] = (user.cards[itemId] || 0) + 1; user.pph += card.basePph; }
                }
                if (user.referredBy && users[user.referredBy]) {
                    const bonusPoints = Math.floor(amountTon * 100000);
                    users[user.referredBy].points += bonusPoints;
                    users[user.referredBy].referralPointsEarned += bonusPoints;
                }
            }
        }
    } catch (err) { console.error("TON Verifier Error:", err.message); }
}
setInterval(checkIncomingTonTransactions, 10000);

app.listen(PORT, () => {
    console.log(`🚀 Server Robi's Lab berjalan di port ${PORT}`);
    console.log(`💎 Master Wallet Aktif: ${systemConfig.adminMasterWallet}`);
});
