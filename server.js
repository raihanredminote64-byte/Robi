require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const { beginCell } = require('@ton/core');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "Raihan3110";

const LOCAL_DB_PATH = path.join(__dirname, 'database.json');
const TMP_DB_PATH = path.join(os.tmpdir(), 'robi-lab-database.json');

let systemConfig = {
    adminMasterWallet: process.env.ADMIN_WALLET || "UQCul5GCA1kYB8Mvp-dLtLTp8tnxgNzuYYwhS-jFY5PNfQQE",
    toncenterApiKey: process.env.TONCENTER_API_KEY || "c25daab1896cfdef11073094a586f7c2cafd83caf21f505e203ad6ec0e726210",
    robiJettonMaster: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
    targetSupplyPool: 10000000,
    pphPointEquivalent: 50,
    vipMultiplier: 3.0,
    pphClaimIntervalHours: 3,
    maxOfflineFreeHours: 3,
    conversionLocked: true,
    withdrawLocked: true,
    updatedAt: Date.now()
};

let vipVariantsList = [
    { id: 'vip_bronze', name: 'VIP Bronze', icon: '🥉', costTon: 1.0, multiplier: 2.0, tapGain: 15, pphBonus: 5000, maxOfflineHours: 12 },
    { id: 'vip_gold', name: 'VIP Gold', icon: '👑', costTon: 3.0, multiplier: 4.0, tapGain: 50, pphBonus: 25000, maxOfflineHours: 24 },
    { id: 'vip_sultan', name: 'VIP Quantum Sultan', icon: '💎', costTon: 5.0, multiplier: 7.0, tapGain: 100, pphBonus: 75000, maxOfflineHours: 48 }
];

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
    { id: 'm1', title: 'Gabung Channel Telegram Robi', reward: 5000, link: 'https://t.me/' },
    { id: 'm2', title: 'Ikuti X / Twitter Resmi Robi', reward: 7500, link: 'https://x.com/' }
];

let users = {};
let claimRequests = [];
const processedTxHashes = new Set();

function loadDatabase() {
    for (const dbPath of [LOCAL_DB_PATH, TMP_DB_PATH]) {
        if (fs.existsSync(dbPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
                if (parsed.systemConfig) systemConfig = { ...systemConfig, ...parsed.systemConfig };
                if (Array.isArray(parsed.vipVariantsList) && parsed.vipVariantsList.length > 0) vipVariantsList = parsed.vipVariantsList;
                if (Array.isArray(parsed.labCardsCatalog) && parsed.labCardsCatalog.length > 0) labCardsCatalog = parsed.labCardsCatalog;
                if (Array.isArray(parsed.missionsList)) missionsList = parsed.missionsList;
                if (parsed.users) users = { ...users, ...parsed.users };
                if (Array.isArray(parsed.claimRequests)) claimRequests = parsed.claimRequests;
                break;
            } catch (e) {}
        }
    }
}

function saveDatabase() {
    const payload = JSON.stringify({ systemConfig, vipVariantsList, labCardsCatalog, missionsList, users, claimRequests }, null, 2);
    try {
        fs.writeFileSync(LOCAL_DB_PATH, payload, 'utf-8');
    } catch (err) {
        try { fs.writeFileSync(TMP_DB_PATH, payload, 'utf-8'); } catch (e) {}
    }
}

loadDatabase();

function getUserVipVariant(user) {
    if (!user.isVip) return null;
    if (user.vipVariantId) {
        const found = vipVariantsList.find(v => v.id === user.vipVariantId);
        if (found) return found;
    }
    return vipVariantsList[0] || { id: 'vip_default', name: 'VIP Member', icon: '⭐', multiplier: systemConfig.vipMultiplier || 3.0, maxOfflineHours: 24 };
}

function getOrCreateUser(userId, username = "Ilmuwan_Robi", refId = null, clientBackup = null) {
    const uid = String(userId);
    const now = Date.now();

    if (!users[uid]) {
        users[uid] = {
            id: uid,
            username: username || "Ilmuwan_Robi",
            points: 5000,
            pph: 100,
            tapPower: 1,
            energy: 1000,
            maxEnergy: 1000,
            isVip: false,
            vipVariantId: null,
            vipVariantName: null,
            vipMultiplier: 1.0,
            tonSpent: 0,
            cards: { c1: 1 },
            completedMissions: [],
            referredBy: refId && String(refId) !== uid ? String(refId) : null,
            referrals: [],
            referralPointsEarned: 0,
            customTokenOverride: null,
            customUnlock: false,
            isBanned: false,
            lastSync: now,
            lastEnergyTime: now,
            lastPphClaimTime: now,
            adminEditTime: 0
        };

        if (refId && users[String(refId)] && String(refId) !== uid) {
            const refUser = users[String(refId)];
            if (!refUser.referrals.includes(uid)) {
                refUser.points += 10000;
                refUser.referralPointsEarned += 10000;
                refUser.referrals.push(uid);
            }
        }
    }

    const user = users[uid];
    if (username && username !== "ilmuwan_robi") user.username = username;
    if (!user.lastPphClaimTime) user.lastPphClaimTime = now;
    if (!user.lastEnergyTime) user.lastEnergyTime = now;
    if (!user.cards) user.cards = { c1: 1 };
    if (!Array.isArray(user.completedMissions)) user.completedMissions = [];

    if (clientBackup && typeof clientBackup === 'object') {
        const clientAdminTime = Number(clientBackup.adminEditTime || 0);
        if (clientAdminTime >= (user.adminEditTime || 0)) {
            if (typeof clientBackup.points === 'number' && clientBackup.points > user.points) user.points = Math.floor(clientBackup.points);
            if (typeof clientBackup.pph === 'number' && clientBackup.pph > user.pph) user.pph = Math.floor(clientBackup.pph);
            if (typeof clientBackup.tapPower === 'number' && clientBackup.tapPower > user.tapPower) user.tapPower = Math.floor(clientBackup.tapPower);
            if (clientBackup.isVip === true) {
                user.isVip = true;
                if (clientBackup.vipVariantId && !user.vipVariantId) user.vipVariantId = clientBackup.vipVariantId;
            }
            if (typeof clientBackup.tonSpent === 'number' && clientBackup.tonSpent > user.tonSpent) user.tonSpent = clientBackup.tonSpent;
            if (clientBackup.cards && typeof clientBackup.cards === 'object') {
                for (const [k, v] of Object.entries(clientBackup.cards)) {
                    user.cards[k] = Math.max(user.cards[k] || 0, Number(v) || 0);
                }
            }
            if (Array.isArray(clientBackup.completedMissions)) {
                clientBackup.completedMissions.forEach(mId => {
                    if (!user.completedMissions.includes(mId)) user.completedMissions.push(mId);
                });
            }
            if (clientBackup.lastPphClaimTime && clientBackup.lastPphClaimTime < user.lastPphClaimTime) {
                user.lastPphClaimTime = Number(clientBackup.lastPphClaimTime);
            }
        }
    }

    const activeVariant = getUserVipVariant(user);
    if (activeVariant) {
        user.vipVariantName = `${activeVariant.icon} ${activeVariant.name}`;
        user.vipMultiplier = Number(activeVariant.multiplier) || Number(systemConfig.vipMultiplier) || 3.0;
    } else {
        user.vipVariantName = null;
        user.vipMultiplier = 1.0;
    }

    const elapsedEnergySec = Math.max(0, (now - user.lastEnergyTime) / 1000);
    if (elapsedEnergySec >= 1) {
        user.energy = Math.min(user.maxEnergy || 1000, user.energy + Math.floor(elapsedEnergySec * 2));
        user.lastEnergyTime = now;
    }

    return user;
}

function getPphStatus(user) {
    const now = Date.now();
    const intervalHours = Math.max(0.05, Number(systemConfig.pphClaimIntervalHours) || 3);
    const intervalMs = intervalHours * 3600000;
    const activeVariant = getUserVipVariant(user);
    const maxHours = activeVariant ? (Number(activeVariant.maxOfflineHours) || 24) : Math.max(intervalHours, Number(systemConfig.maxOfflineFreeHours) || 3);
    const maxMs = maxHours * 3600000;

    const elapsedMs = Math.max(0, now - (user.lastPphClaimTime || now));
    const effectiveMs = Math.min(elapsedMs, maxMs);
    const accumulatedPoints = Math.floor((effectiveMs / 3600000) * user.pph);
    const canClaim = elapsedMs >= intervalMs && accumulatedPoints >= 1;
    const remainingMsToClaim = Math.max(0, intervalMs - elapsedMs);
    const progressPct = Math.min(100, +((elapsedMs / intervalMs) * 100).toFixed(2));

    return { accumulatedPoints, canClaim, remainingMsToClaim, intervalHours, maxHours, progressPct, lastPphClaimTime: user.lastPphClaimTime };
}

function getUserRawWeight(user) {
    const baseScore = user.points + (user.pph * systemConfig.pphPointEquivalent);
    if (!user.isVip) return baseScore;
    const activeVariant = getUserVipVariant(user);
    const multi = activeVariant ? (Number(activeVariant.multiplier) || systemConfig.vipMultiplier) : systemConfig.vipMultiplier;
    return baseScore * multi;
}

function getGlobalAutoFitStats() {
    const allUsersList = Object.values(users);
    let totalWeightedScore = 0, totalRawPoints = 0, totalRawPph = 0, totalTonCollected = 0;
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

function buildUserResponse(user) {
    const isConversionOpenForUser = !systemConfig.conversionLocked || user.customUnlock === true;
    const isWithdrawOpenForUser = !systemConfig.withdrawLocked || user.customUnlock === true;
    const stats = getGlobalAutoFitStats();

    return {
        user,
        pphStatus: getPphStatus(user),
        estimatedRobiTokens: isConversionOpenForUser ? calculateFinalRobiTokens(user, stats.autoFitRatio) : null,
        lockStatus: { conversionLocked: !isConversionOpenForUser, withdrawLocked: !isWithdrawOpenForUser },
        config: {
            adminMasterWallet: systemConfig.adminMasterWallet,
            ratioDivider: isConversionOpenForUser ? stats.autoFitRatio : null,
            vipMultiplier: systemConfig.vipMultiplier,
            pphClaimIntervalHours: systemConfig.pphClaimIntervalHours || 3
        },
        vipVariants: vipVariantsList,
        catalog: labCardsCatalog,
        missions: missionsList
    };
}

app.post('/api/user/sync', (req, res) => {
    const { userId, username, refId, taps, clientBackup } = req.body;
    if (!userId) return res.status(400).json({ error: "userId diperlukan" });

    const user = getOrCreateUser(userId, username, refId, clientBackup);
    if (user.isBanned) return res.status(403).json({ error: "Akun Anda telah dibekukan oleh Admin." });

    const tapCount = Number(taps) || 0;
    if (tapCount > 0) {
        const maxPossibleTaps = Math.ceil(user.energy / user.tapPower);
        const validTaps = Math.min(tapCount, Math.max(1, maxPossibleTaps));
        const pointsEarned = validTaps * user.tapPower;
        user.points += pointsEarned;
        user.energy = Math.max(0, user.energy - pointsEarned);
        user.lastSync = Date.now();
    }

    saveDatabase();
    res.json(buildUserResponse(user));
});

app.post('/api/user/claim-pph', (req, res) => {
    const { userId, clientBackup } = req.body;
    const user = getOrCreateUser(userId, null, null, clientBackup);
    if (user.isBanned) return res.status(403).json({ error: "Akun dibekukan." });

    const status = getPphStatus(user);
    if (!status.canClaim) {
        const remTotalSec = Math.ceil(status.remainingMsToClaim / 1000);
        const hrs = Math.floor(remTotalSec / 3600);
        const mins = Math.floor((remTotalSec % 3600) / 60);
        const secs = remTotalSec % 60;
        return res.status(400).json({ error: `⏳ Mesin Riset PPH baru bisa diklaim setiap ${status.intervalHours} jam! Tunggu ${hrs}j ${mins}m ${secs}d lagi.` });
    }

    user.points += status.accumulatedPoints;
    user.lastPphClaimTime = Date.now();
    user.lastSync = Date.now();
    saveDatabase();

    res.json({
        message: `🧪 Berhasil klaim +${status.accumulatedPoints.toLocaleString('id-ID')} Poin Riset dari PPH!`,
        claimedAmount: status.accumulatedPoints,
        ...buildUserResponse(user)
    });
});

app.post('/api/user/upgrade-points', (req, res) => {
    const { userId, cardId, clientBackup } = req.body;
    const user = getOrCreateUser(userId, null, null, clientBackup);
    const card = labCardsCatalog.find(c => c.id === cardId);

    if (!card) return res.status(400).json({ error: "Item alat lab tidak ditemukan!" });
    if (card.currency !== 'POINTS') return res.status(400).json({ error: "Item ini harus dibeli menggunakan TON!" });

    const currentLvl = user.cards[cardId] || 0;
    const cost = Math.floor(card.baseCost * Math.pow(1.5, currentLvl));
    const pphGain = Math.floor(card.basePph * Math.pow(1.2, currentLvl));

    if (user.points < cost) return res.status(400).json({ error: `Poin riset tidak cukup! Butuh ${cost.toLocaleString('id-ID')} Poin.` });

    user.points -= cost;
    user.pph += pphGain;
    user.cards[cardId] = currentLvl + 1;
    user.lastSync = Date.now();
    saveDatabase();

    res.json({
        message: `🔬 Berhasil upgrade ${card.name} ke Lvl ${user.cards[cardId]}! (+${pphGain.toLocaleString('id-ID')} PPH)`,
        ...buildUserResponse(user)
    });
});

app.post('/api/user/complete-mission', (req, res) => {
    const { userId, missionId, clientBackup } = req.body;
    const user = getOrCreateUser(userId, null, null, clientBackup);
    const mission = missionsList.find(m => m.id === missionId);

    if (!mission) return res.status(400).json({ error: "Misi tidak ditemukan!" });
    if (user.completedMissions.includes(missionId)) return res.status(400).json({ error: "Misi ini sudah pernah kamu klaim!" });

    user.completedMissions.push(missionId);
    user.points += Number(mission.reward) || 0;
    user.lastSync = Date.now();
    saveDatabase();

    res.json({
        message: `🎉 Misi selesai! Kamu mendapat +${Number(mission.reward).toLocaleString('id-ID')} Poin Riset!`,
        ...buildUserResponse(user)
    });
});

app.get('/api/ton/create-payload', (req, res) => {
    try {
        const comment = req.query.comment || "";
        const cell = beginCell().storeUint(0, 32).storeStringTail(comment).endCell();
        res.json({ payloadBoc: cell.toBoc().toString('base64') });
    } catch (e) {
        res.json({ payloadBoc: "" });
    }
});

app.post('/api/user/claim-robi', (req, res) => {
    const { userId, walletAddress, clientBackup } = req.body;
    const user = getOrCreateUser(userId, null, null, clientBackup);

    const isConversionOpen = !systemConfig.conversionLocked || user.customUnlock === true;
    const isWithdrawOpen = !systemConfig.withdrawLocked || user.customUnlock === true;

    if (!isConversionOpen || !isWithdrawOpen) return res.status(403).json({ error: "🔒 Fitur Konversi & Withdraw masih dikunci oleh Admin!" });

    const tokenAmount = calculateFinalRobiTokens(user);
    if (tokenAmount < 5) return res.status(400).json({ error: "Minimal klaim adalah 5 Token $ROBI." });

    claimRequests.push({
        claimId: "CLM-" + Date.now(),
        userId: user.id,
        username: user.username,
        walletAddress,
        pointsSnapshot: user.points,
        pphSnapshot: user.pph,
        isVip: user.isVip,
        vipVariantName: user.vipVariantName || "Non-VIP",
        tonSpent: user.tonSpent,
        finalRobiAmount: tokenAmount,
        status: "PENDING",
        createdAt: new Date().toISOString()
    });

    user.points = 0;
    user.adminEditTime = Date.now();
    saveDatabase();

    res.json({
        message: `✅ Konversi berhasil! Klaim ${tokenAmount.toLocaleString('id-ID')} Token $ROBI masuk antrean Admin.`,
        ...buildUserResponse(user)
    });
});

function verifyAdmin(req, res, next) {
    const headerSecret = (req.headers['x-admin-secret'] || "").trim();
    if (headerSecret !== ADMIN_SECRET && headerSecret !== "Raihan3110") {
        return res.status(403).json({ error: "Secret Key Admin Salah! Gunakan: Raihan3110" });
    }
    next();
}

function getAdminDashboardPayload() {
    const stats = getGlobalAutoFitStats();
    let totalAllocatedRobi = 0, vipRobiSum = 0, freeRobiSum = 0;
    const allUsers = Object.values(users).map(u => {
        const calculatedRobi = calculateFinalRobiTokens(u, stats.autoFitRatio);
        totalAllocatedRobi += calculatedRobi;
        if (u.isVip) vipRobiSum += calculatedRobi; else freeRobiSum += calculatedRobi;
        return { ...u, rawWeight: getUserRawWeight(u), calculatedRobi };
    });
    return {
        systemConfig,
        vipVariants: vipVariantsList,
        autoFitStats: { ...stats, totalAllocatedRobi, vipRobiSum, freeRobiSum },
        users: allUsers,
        claimRequests,
        missions: missionsList,
        catalog: labCardsCatalog
    };
}

app.get('/api/admin/dashboard', verifyAdmin, (req, res) => {
    res.json(getAdminDashboardPayload());
});

app.post('/api/admin/save-all', verifyAdmin, (req, res) => {
    const { configUpdate, vipVariantsUpdate, catalogUpdate, missionsUpdate } = req.body;
    if (configUpdate && typeof configUpdate === 'object') {
        if (configUpdate.adminMasterWallet) configUpdate.adminMasterWallet = configUpdate.adminMasterWallet.trim();
        systemConfig = {
            ...systemConfig,
            ...configUpdate,
            targetSupplyPool: Number(configUpdate.targetSupplyPool ?? systemConfig.targetSupplyPool),
            vipMultiplier: Number(configUpdate.vipMultiplier ?? systemConfig.vipMultiplier),
            pphPointEquivalent: Number(configUpdate.pphPointEquivalent ?? systemConfig.pphPointEquivalent),
            pphClaimIntervalHours: Number(configUpdate.pphClaimIntervalHours ?? systemConfig.pphClaimIntervalHours),
            conversionLocked: Boolean(configUpdate.conversionLocked),
            withdrawLocked: Boolean(configUpdate.withdrawLocked),
            updatedAt: Date.now()
        };
    }
    if (Array.isArray(vipVariantsUpdate) && vipVariantsUpdate.length > 0) vipVariantsList = vipVariantsUpdate;
    if (Array.isArray(catalogUpdate)) labCardsCatalog = catalogUpdate;
    if (Array.isArray(missionsUpdate)) missionsList = missionsUpdate;

    saveDatabase();
    res.json({
        message: "✅ Seluruh Pengaturan Sistem, Varian VIP, Item Upgrade Lab, dan Misi berhasil disimpan!",
        ...getAdminDashboardPayload()
    });
});

app.post('/api/admin/add-vip-variant', verifyAdmin, (req, res) => {
    const { id, name, icon, costTon, multiplier, tapGain, pphBonus, maxOfflineHours } = req.body;
    if (!name || costTon === undefined || costTon === "" || multiplier === undefined || multiplier === "") {
        return res.status(400).json({ error: "Nama Varian VIP, Harga TON, dan Multiplier wajib diisi!" });
    }
    const variantObj = {
        id: id || ('vip_' + Date.now()),
        name: String(name).trim(),
        icon: icon ? String(icon).trim() : '👑',
        costTon: Number(costTon),
        multiplier: Number(multiplier),
        tapGain: Number(tapGain) || 0,
        pphBonus: Number(pphBonus) || 0,
        maxOfflineHours: Number(maxOfflineHours) || 24
    };
    const existingIdx = vipVariantsList.findIndex(v => v.id === variantObj.id);
    if (existingIdx !== -1) vipVariantsList[existingIdx] = variantObj;
    else vipVariantsList.push(variantObj);

    systemConfig.updatedAt = Date.now();
    saveDatabase();
    res.json({
        message: `✅ Varian VIP "${variantObj.icon} ${variantObj.name}" (${variantObj.costTon} TON | ${variantObj.multiplier}x) berhasil disimpan!`,
        ...getAdminDashboardPayload()
    });
});

app.post('/api/admin/delete-vip-variant', verifyAdmin, (req, res) => {
    const { variantId } = req.body;
    vipVariantsList = vipVariantsList.filter(v => v.id !== variantId);
    systemConfig.updatedAt = Date.now();
    saveDatabase();
    res.json({ message: "🗑️ Varian VIP berhasil dihapus!", ...getAdminDashboardPayload() });
});

app.post('/api/admin/change-wallet', verifyAdmin, (req, res) => {
    const { newWalletAddress, newApiKey } = req.body;
    if (!newWalletAddress || newWalletAddress.trim().length < 10) {
        return res.status(400).json({ error: "❌ Alamat Wallet TON tidak boleh kosong!" });
    }
    systemConfig.adminMasterWallet = newWalletAddress.trim();
    if (newApiKey && newApiKey.trim() !== "") systemConfig.toncenterApiKey = newApiKey.trim();
    systemConfig.updatedAt = Date.now();
    saveDatabase();
    res.json({
        message: `✅ Alamat Master Wallet TON berhasil disimpan:
${systemConfig.adminMasterWallet}`,
        ...getAdminDashboardPayload()
    });
});

app.post('/api/admin/add-lab-card', verifyAdmin, (req, res) => {
    const { id, name, icon, baseCost, basePph, currency, category } = req.body;
    if (!name || baseCost === undefined || baseCost === "" || basePph === undefined || basePph === "") {
        return res.status(400).json({ error: "Nama Alat, Harga Dasar, dan Tambahan PPH wajib diisi!" });
    }
    const curr = currency === 'TON' ? 'TON' : 'POINTS';
    const cat = category || (curr === 'TON' ? 'vip' : 'kimia');

    if (id) {
        const existingIdx = labCardsCatalog.findIndex(c => c.id === id);
        if (existingIdx !== -1) {
            labCardsCatalog[existingIdx] = {
                ...labCardsCatalog[existingIdx],
                name: String(name).trim(),
                icon: icon ? String(icon).trim() : '🧪',
                baseCost: Number(baseCost),
                basePph: Number(basePph),
                currency: curr,
                category: cat
            };
            systemConfig.updatedAt = Date.now();
            saveDatabase();
            return res.json({ message: `✅ Item "${name}" berhasil diperbarui dan disimpan!`, ...getAdminDashboardPayload() });
        }
    }

    const newCard = {
        id: 'card_' + Date.now(),
        category: cat,
        name: String(name).trim(),
        icon: icon ? String(icon).trim() : (curr === 'TON' ? '🤖' : '🧪'),
        baseCost: Number(baseCost),
        basePph: Number(basePph),
        currency: curr
    };
    labCardsCatalog.push(newCard);
    systemConfig.updatedAt = Date.now();
    saveDatabase();
    res.json({ message: `✅ Item Upgrade Lab "${newCard.name}" berhasil ditambahkan dan disimpan!`, ...getAdminDashboardPayload() });
});

app.post('/api/admin/delete-lab-card', verifyAdmin, (req, res) => {
    const { cardId } = req.body;
    labCardsCatalog = labCardsCatalog.filter(c => c.id !== cardId);
    systemConfig.updatedAt = Date.now();
    saveDatabase();
    res.json({ message: "🗑️ Item upgrade berhasil dihapus!", ...getAdminDashboardPayload() });
});

app.post('/api/admin/add-mission', verifyAdmin, (req, res) => {
    const { id, title, reward, link } = req.body;
    if (!title || reward === undefined || reward === "") {
        return res.status(400).json({ error: "Judul Misi dan Hadiah Poin wajib diisi!" });
    }
    if (id) {
        const existingIdx = missionsList.findIndex(m => m.id === id);
        if (existingIdx !== -1) {
            missionsList[existingIdx] = {
                ...missionsList[existingIdx],
                title: String(title).trim(),
                reward: Number(reward),
                link: link ? String(link).trim() : 'https://t.me/'
            };
            systemConfig.updatedAt = Date.now();
            saveDatabase();
            return res.json({ message: `✅ Misi "${title}" berhasil diperbarui dan disimpan!`, ...getAdminDashboardPayload() });
        }
    }

    const newMission = {
        id: 'm_' + Date.now(),
        title: String(title).trim(),
        reward: Number(reward),
        link: link ? String(link).trim() : 'https://t.me/'
    };
    missionsList.push(newMission);
    systemConfig.updatedAt = Date.now();
    saveDatabase();
    res.json({ message: `✅ Misi "${newMission.title}" (+${newMission.reward.toLocaleString('id-ID')} Poin) berhasil ditambahkan dan disimpan!`, ...getAdminDashboardPayload() });
});

app.post('/api/admin/delete-mission', verifyAdmin, (req, res) => {
    const { missionId } = req.body;
    missionsList = missionsList.filter(m => m.id !== missionId);
    systemConfig.updatedAt = Date.now();
    saveDatabase();
    res.json({ message: "🗑️ Misi berhasil dihapus!", ...getAdminDashboardPayload() });
});

app.post('/api/admin/edit-user', verifyAdmin, (req, res) => {
    const { userId, points, pph, vipVariantId, isBanned, customTokenOverride, customUnlock } = req.body;
    const user = getOrCreateUser(userId);

    if (points !== undefined && points !== "") user.points = Number(points);
    if (pph !== undefined && pph !== "") user.pph = Number(pph);

    if (vipVariantId !== undefined) {
        if (!vipVariantId || vipVariantId === "FREE") {
            user.isVip = false;
            user.vipVariantId = null;
            user.vipVariantName = null;
            user.vipMultiplier = 1.0;
        } else {
            const chosenVariant = vipVariantsList.find(v => v.id === vipVariantId);
            user.isVip = true;
            user.vipVariantId = vipVariantId;
            if (chosenVariant) {
                user.vipVariantName = `${chosenVariant.icon} ${chosenVariant.name}`;
                user.vipMultiplier = Number(chosenVariant.multiplier) || 3.0;
            }
        }
    }

    if (typeof isBanned === 'boolean') user.isBanned = isBanned;
    if (typeof customUnlock === 'boolean') user.customUnlock = customUnlock;
    if (customTokenOverride !== undefined) {
        user.customTokenOverride = customTokenOverride === "" || customTokenOverride === null ? null : Number(customTokenOverride);
    }
    user.adminEditTime = Date.now();
    saveDatabase();

    res.json({ message: `✅ Data & Varian VIP pemain @${user.username} berhasil disimpan!`, ...getAdminDashboardPayload() });
});

async function checkIncomingTonTransactions() {
    if (!systemConfig.toncenterApiKey || !systemConfig.adminMasterWallet) return;
    try {
        const url = `https://toncenter.com/api/v2/getTransactions?address=${systemConfig.adminMasterWallet}&limit=15&api_key=${systemConfig.toncenterApiKey}`;
        const { data } = await axios.get(url);
        if (!data.result) return;
        let updated = false;
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

                const boughtVariant = vipVariantsList.find(v => v.id === itemId);
                if (boughtVariant) {
                    user.vipVariantId = boughtVariant.id;
                    user.vipVariantName = `${boughtVariant.icon} ${boughtVariant.name}`;
                    user.vipMultiplier = Number(boughtVariant.multiplier) || 3.0;
                    user.tapPower += (Number(boughtVariant.tapGain) || 0);
                    user.pph += (Number(boughtVariant.pphBonus) || 0);
                } else {
                    const card = labCardsCatalog.find(c => c.id === itemId);
                    if (card) {
                        user.cards[itemId] = (user.cards[itemId] || 0) + 1;
                        user.pph += card.basePph;
                    }
                    if (!user.vipVariantId && vipVariantsList[0]) user.vipVariantId = vipVariantsList[0].id;
                }

                if (user.referredBy && users[user.referredBy]) {
                    const bonusPoints = Math.floor(amountTon * 100000);
                    users[user.referredBy].points += bonusPoints;
                    users[user.referredBy].referralPointsEarned += bonusPoints;
                }
                user.adminEditTime = Date.now();
                updated = true;
            }
        }
        if (updated) saveDatabase();
    } catch (err) {}
}
setInterval(checkIncomingTonTransactions, 12000);

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Server Robi's Lab berjalan di port ${PORT}`);
    });
}

module.exports = app;