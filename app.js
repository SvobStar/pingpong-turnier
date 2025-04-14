// HIER KOMMEN SPÄTER DEINE SUPABASE DATEN REIN
// const SUPABASE_URL = 'DEINE_SUPABASE_URL';        // <-- FRAGE: Wie lautet deine Supabase Project URL?
// const SUPABASE_ANON_KEY = 'DEIN_SUPABASE_ANON_KEY'; // <-- FRAGE: Wie lautet dein Supabase anon public Key?

// const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // Wird aktiviert in Phase 2

// Globale Variablen für Phase 1 (localStorage Simulation)
let currentUser = null; // Angemeldeter Benutzer { id, username, ..., verified }
let participants = []; // Alle registrierten Teilnehmer
let tournamentData = { // Struktur für Turnierdaten
    groups: [], // { id: 'A', players: [userId1, userId2,...], matches: [], standings: [] }
    knockoutMatches: {}, // { round16: [...], quarter: [...], semi: [...], final: ..., place3: ..., place58_semi: [...], place5: ..., place7: ... }
    schedule: [], // { matchId, time, player1, player2, type: 'group'/'ko', groupId/roundType, table, result? }
    results: {} // { matchId: { score1: null, score2: null, confirmed: false, reportedBy: null, winner: null, loser: null } }
};
const startTime = new Date(); // Basis für Zeitplanung
startTime.setHours(13, 30, 0, 0); // Turnierstart 13:30 Uhr
const matchDuration = 7; // Minuten (Gruppe)
const breakDuration = 3; // Minuten (Gruppe)
const KO_MATCH_DURATION_MIN = 25; // Geschätzte Dauer für ein KO-Spiel
const KO_BREAK_DURATION_MIN = 5;  // Pause danach
const BUFFER_AFTER_GROUP_MIN = 15; // Puffer nach letztem Gruppenspiel

// Globale Zustandsvariablen für Phase 2 (ersetzen dann die oberen)
// let currentSession = null;
// let currentUserProfile = null;

// Globale Variablen für Spiellogik (behalten wir)
let finalRanks = {}; // { playerId: rank }
let quarterFinalLosers = []; // [{ playerId: id, score: scoreInLostQF, groupPoints: points }]
let tableAvailableTimes = Array(12).fill(null);
let lastKoMatchStartTime = null;


// --- DOM-Elemente holen ---
// (Hier alle getElementById Aufrufe einfügen, wie im vorherigen Code)
const authScreen = document.getElementById('auth-screen');
const mainScreen = document.getElementById('main-screen');
const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const verifyScreen = document.getElementById('verify-screen');
const tournamentOverview = document.getElementById('tournament-overview');
const tournamentPlan = document.getElementById('tournament-plan');
const showRegisterBtn = document.getElementById('show-register-btn');
const showLoginBtn = document.getElementById('show-login-btn');
const participateBtn = document.getElementById('participate-btn');
const nameFilterInput = document.getElementById('name-filter');
const leaderboardList = document.getElementById('leaderboard-list');
const groupStageContainer = document.getElementById('group-stage');
const knockoutStageContainer = document.getElementById('knockout-stage');
const eventDateElement = document.getElementById('event-date');
const adminPanel = document.getElementById('admin-panel'); // Admin Panel holen

// Modal Elemente
const resultModal = document.getElementById('result-modal');
const confirmModal = document.getElementById('confirm-modal');
const closeResultModalBtn = resultModal.querySelector('.close-btn');
const closeConfirmModalBtn = confirmModal.querySelector('.close-confirm-btn');
const resultForm = document.getElementById('result-form');
const confirmAcceptBtn = document.getElementById('confirm-result-accept-btn');
const confirmRejectBtn = document.getElementById('confirm-result-reject-btn');


// --- Hilfsfunktionen ---

// !! PHASE 1: localStorage Speicherung !!
const saveData = () => {
    try {
        localStorage.setItem('pingpong_currentUser', JSON.stringify(currentUser));
        localStorage.setItem('pingpong_participants', JSON.stringify(participants));
        // Konvertiere Dates zu ISO Strings vor dem Speichern
        const dataToSave = JSON.parse(JSON.stringify(tournamentData)); // Deep copy
        dataToSave.schedule.forEach(m => { if(m.time) m.time = m.time.toISOString(); });
        localStorage.setItem('pingpong_tournamentData', JSON.stringify(dataToSave));
        localStorage.setItem('pingpong_nameFilter', nameFilterInput.value);
        localStorage.setItem('pingpong_finalRanks', JSON.stringify(finalRanks));
        localStorage.setItem('pingpong_qfLosers', JSON.stringify(quarterFinalLosers));
    } catch (e) {
        console.error("Error saving data to localStorage:", e);
        // Mögliche Ursache: Speicher voll oder Objekt nicht serialisierbar
    }
};

const loadData = () => {
    currentUser = JSON.parse(localStorage.getItem('pingpong_currentUser')) || null;
    participants = JSON.parse(localStorage.getItem('pingpong_participants')) || [];
    const loadedTournamentData = JSON.parse(localStorage.getItem('pingpong_tournamentData'));
    if (loadedTournamentData) {
        // Konvertiere ISO Strings zurück zu Dates
         loadedTournamentData.schedule.forEach(m => { if(m.time) m.time = new Date(m.time); });
         tournamentData = loadedTournamentData;
    } else {
         // Reset auf Default-Struktur falls nichts geladen wurde
          tournamentData = { groups: [], knockoutMatches: {}, schedule: [], results: {} };
    }
    // Initialisiere leere Strukturen, falls sie fehlen
    tournamentData.groups = tournamentData.groups || [];
    tournamentData.knockoutMatches = tournamentData.knockoutMatches || {};
    tournamentData.schedule = tournamentData.schedule || [];
    tournamentData.results = tournamentData.results || {};


    nameFilterInput.value = localStorage.getItem('pingpong_nameFilter') || '';
    finalRanks = JSON.parse(localStorage.getItem('pingpong_finalRanks')) || {};
    quarterFinalLosers = JSON.parse(localStorage.getItem('pingpong_qfLosers')) || [];
     // Initialisiere Tischzeiten nach Laden der Daten
    tableAvailableTimes = Array(12).fill(null);
    lastKoMatchStartTime = null; // Reset bei jedem Laden
};
// !! ENDE PHASE 1 localStorage !!

const showScreen = (screenToShow) => {
    authScreen.classList.add('hidden');
    mainScreen.classList.add('hidden');
    screenToShow.classList.remove('hidden');
};

const showAuthForm = (formToShow) => {
    registerForm.classList.add('hidden');
    loginForm.classList.add('hidden');
    verifyScreen.classList.add('hidden');
    if (formToShow) {
        formToShow.classList.remove('hidden');
    }
}

const showMessage = (elementId, text, isSuccess = false) => {
    const element = document.getElementById(elementId);
    if(element) {
        element.textContent = text;
        element.className = isSuccess ? 'message success' : 'message';
    }
}

const getParticipantById = (id) => participants.find(p => p.id === id);
const getParticipantByUsername = (username) => participants.find(p => p.username && p.username.toLowerCase() === username.toLowerCase());
const getParticipantByEmail = (email) => participants.find(p => p.email && p.email.toLowerCase() === email.toLowerCase());

// Helper function to find a KO match by ID across all rounds
function findKnockoutMatchById(matchId) {
    if (!matchId) return null;
    for (const roundKey in tournamentData.knockoutMatches) {
        const round = tournamentData.knockoutMatches[roundKey];
        if (Array.isArray(round)) {
             const match = round.find(m => m.matchId === matchId);
             if (match) return match;
        }
    }
    return null;
}

// --- Initialisierung ---
document.addEventListener('DOMContentLoaded', () => {
    loadData(); // Lade Daten aus localStorage (Phase 1)
    setupInitialView(); // Initialisiere Ansicht
    updateTournamentOverview(); // Setze Datum etc.
    addEventListeners(); // Füge alle Event Listener hinzu
});


// --- Initialisierungslogik für Ansicht ---
function setupInitialView() {
    // Phase 1 Logik (currentUser)
    if (currentUser && currentUser.verified) {
        showScreen(mainScreen);
        displayTournamentOverview();
    } else if (currentUser && !currentUser.verified) {
        showScreen(authScreen);
        showAuthForm(verifyScreen);
        const emailDisplay = document.getElementById('verify-email-display');
         if (emailDisplay) emailDisplay.textContent = currentUser.email;
    }
    else {
        showScreen(authScreen);
        showAuthForm(null);
    }
     // Phase 2 Logik (currentSession) - wird später aktiviert
     /*
     if (currentSession && currentUserProfile) {
         showScreen(mainScreen);
         displayTournamentOverview();
     } else {
         showScreen(authScreen);
         showAuthForm(null);
     }
     */
}

// --- Event Listener hinzufügen ---
function addEventListeners() {
    showRegisterBtn.addEventListener('click', () => showAuthForm(registerForm));
    showLoginBtn.addEventListener('click', () => showAuthForm(loginForm));
    participateBtn.addEventListener('click', () => {
        tournamentOverview.classList.add('hidden');
        tournamentPlan.classList.remove('hidden');
        displayTournamentPlan();
    });

    document.querySelector('#main-screen header h1').addEventListener('click', () => {
        if(mainScreen.classList.contains('hidden')) return;
        tournamentPlan.classList.add('hidden');
        tournamentOverview.classList.remove('hidden');
        displayTournamentOverview();
    });

    registerForm.addEventListener('submit', handleRegister);
    loginForm.addEventListener('submit', handleLogin);
    document.getElementById('verify-submit-btn')?.addEventListener('click', handleVerify); // Sicherstellen, dass Button existiert

    nameFilterInput.addEventListener('input', () => {
        if (!localStorage) saveData(); // Filter speichern (Phase 1)
        displayTournamentPlan();
    });

    // Modals
    closeResultModalBtn?.addEventListener('click', () => resultModal.classList.add('hidden'));
    closeConfirmModalBtn?.addEventListener('click', () => confirmModal.classList.add('hidden'));
    resultForm.addEventListener('submit', handleResultSubmit);
    confirmAcceptBtn?.addEventListener('click', handleConfirmAccept);
    confirmRejectBtn?.addEventListener('click', handleConfirmReject);

    // Admin Buttons
    document.getElementById('generate-tournament-btn')?.addEventListener('click', handleGenerateTournament);
    document.getElementById('seed-ko-btn')?.addEventListener('click', handleSeedKo);
}

// --- Authentifizierungs-Handler (Phase 1) ---
function handleRegister(e) {
    e.preventDefault();
    // ... (Code zum Holen der Werte aus dem Formular) ...
     const firstName = document.getElementById('register-firstname').value.trim();
    const lastName = document.getElementById('register-lastname').value.trim();
    const username = document.getElementById('register-username').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const phone = document.getElementById('register-phone').value.trim();
    const password = document.getElementById('register-password').value;

    // Validierung ...
     if (!firstName || !lastName || !username || !email || !phone || !password) {
         showMessage('register-message', 'Bitte alle Felder ausfüllen.'); return;
     }
     if (password.length < 6) {
         showMessage('register-message', 'Passwort muss mind. 6 Zeichen lang sein.'); return;
     }
     if (getParticipantByUsername(username)) {
         showMessage('register-message', 'Benutzername bereits vergeben.'); return;
     }
      if (getParticipantByEmail(email)) {
         showMessage('register-message', 'E-Mailadresse bereits registriert.'); return;
     }


    const newUser = {
        id: `user_${Date.now()}`, // Einfache eindeutige ID für Phase 1
        firstname: firstName, lastname: lastName, username: username,
        email: email, phone: phone, password: password, // !! KLARTEXT PASSWORT NUR FÜR PHASE 1 !!
        verified: false,
        verificationCode: Math.floor(100000 + Math.random() * 900000).toString()
    };

    participants.push(newUser);
    currentUser = newUser;
    saveData();

    console.log(`Simulierter Verifizierungscode für ${email}: ${newUser.verificationCode}`);
    showMessage('register-message', `Registrierung erfolgreich! Code (simuliert): ${newUser.verificationCode}`, true);

    document.getElementById('verify-email-display').textContent = email;
    showAuthForm(verifyScreen);
}

function handleVerify() {
    const codeInput = document.getElementById('verify-code').value.trim();
    if (!currentUser) return;

    if (codeInput === currentUser.verificationCode) {
        currentUser.verified = true;
        const userIndex = participants.findIndex(p => p.id === currentUser.id);
        if (userIndex !== -1) participants[userIndex].verified = true;
        saveData();
        showMessage('verify-message', 'Verifizierung erfolgreich! Du wirst angemeldet.', true);
        setTimeout(() => { setupInitialView(); }, 1500);
    } else {
        showMessage('verify-message', 'Falscher Verifizierungscode.');
    }
}

function handleLogin(e) {
    e.preventDefault();
    // ... (Code zum Holen der Werte aus dem Formular) ...
    const loginIdentifier = document.getElementById('login-username').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;

    const user = participants.find(p =>
        (p.username.toLowerCase() === loginIdentifier || p.email.toLowerCase() === loginIdentifier) &&
        p.password === password // !! NUR FÜR PHASE 1 !!
    );

    if (user) {
        if (user.verified) {
            showMessage('login-message', 'Anmeldung erfolgreich!', true);
            currentUser = user;
            saveData();
            setTimeout(() => { setupInitialView(); }, 1000);
        } else {
            currentUser = user; // Für Verifizierung setzen
            saveData();
            showMessage('login-message', 'Konto noch nicht verifiziert. Code (simuliert): ' + user.verificationCode);
             setTimeout(() => {
                 document.getElementById('verify-email-display').textContent = user.email;
                 showAuthForm(verifyScreen);
             }, 1500);
        }
    } else {
        showMessage('login-message', 'Ungültiger Benutzername/E-Mail oder falsches Passwort.');
    }
}

// --- Turnierplan-Anzeige ---
function updateTournamentOverview() {
     const today = new Date();
     const formattedDate = `<span class="math-inline">\{today\.getDate\(\)\.toString\(\)\.padStart\(2, '0'\)\}\.</span>{(today.getMonth() + 1).toString().padStart(2, '0')}.${today.getFullYear()}`;
     if(eventDateElement) eventDateElement.textContent = formattedDate;
     updateLeaderboard();
 }

 function displayTournamentOverview() {
     tournamentOverview.classList.remove('hidden');
     tournamentPlan.classList.add('hidden');
     updateLeaderboard();
 }

 function displayTournamentPlan() {
     if (!tournamentData || !tournamentData.groups) {
         console.error("Turnierdaten nicht korrekt geladen.");
         groupStageContainer.innerHTML = '<p>Fehler beim Laden der Turnierdaten.</p>';
         knockoutStageContainer.innerHTML = '';
         return;
     }
     console.log("Anzeige Turnierplan mit Filter:", nameFilterInput.value);
     renderGroupStage();
     renderKnockoutStage();
     addResultButtonListeners();
 }

// --- Rendering Funktionen (Gruppen, KO-Baum) ---
// (Hier renderGroupStage und renderKnockoutStage einfügen, wie im vorherigen Code)
function renderGroupStage() {
    if(!groupStageContainer) return;
    groupStageContainer.innerHTML = ''; // Alten Inhalt leeren
    const filter = nameFilterInput.value.toLowerCase().trim();

    if (!tournamentData.groups || tournamentData.groups.length === 0) {
        groupStageContainer.innerHTML = "<p>Noch keine Gruppen generiert.</p>";
        return;
    }


    tournamentData.groups.forEach(group => {
         // Stelle sicher, dass standings verfügbar sind (berechne sie ggf. neu)
         if (!group.standings && group.matches.every(mid => tournamentData.results[mid]?.confirmed)) {
              calculateGroupStandings(group.id); // Neuberechnung, falls alle Spiele fertig sind
         }
         const standings = group.standings || []; // Verwende berechnete oder leere Standings

        const groupPlayers = group.players.map(getParticipantById).filter(p => p); // Filtern falls ein Spieler nicht gefunden wird
        const groupMatchesFilter = !filter || groupPlayers.some(p =>
              p.firstname.toLowerCase().includes(filter) ||
              p.lastname.toLowerCase().includes(filter) ||
              p.username.toLowerCase().includes(filter)
        );

        if (!groupMatchesFilter) return; // Gruppe überspringen

        const groupDiv = document.createElement('div');
        groupDiv.classList.add('group');
        groupDiv.innerHTML = `<h4>Gruppe ${group.id}</h4>`;

        // Spieltabelle
        const table = document.createElement('table');
        table.innerHTML = `<thead><tr><th>#</th><th>Spieler</th><th>Pkt</th><th>+/-</th><th>Sp</th></tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');

         // Verwende die sortierten standings zur Anzeige
         standings.forEach((standing, index) => {
             const player = getParticipantById(standing.id);
             if(player) {
                tbody.innerHTML += `<tr>
                    <td><span class="math-inline">\{standing\.rank \|\| \(index \+ 1\)\}</td\>
