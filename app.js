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
<td>${player.firstname} ${player.lastname}</td>
<td>${standing.points}</td>
<td>
  ${standing.pointDiff > 0 ? '+' : ''}${standing.pointDiff}
</td>
<td>${standing.gamesPlayed}</td>
</tr>;
}
});

// Füge Spieler hinzu, die evtl. noch nicht im Standing sind (falls Tabelle vor Ende angezeigt wird)
groupPlayers.forEach(player => {
  if (!standings.some(s => s.id === player.id)) {
    tbody.innerHTML += `
      <tr>
        <td>-</td>
        <td>${player.firstname} ${player.lastname}</td>
        <td>0</td>
        <td>0</td>
        <td>0</td>
      </tr>
    `;
  }
});

        groupDiv.appendChild(table);

        // Matches der Gruppe anzeigen
        const matchesUl = document.createElement('ul');
        matchesUl.classList.add('match-list');
        group.matches.forEach(matchId => {
            const match = tournamentData.schedule.find(s => s.matchId === matchId);
            if (!match) return;

            const player1 = getParticipantById(match.player1);
            const player2 = getParticipantById(match.player2);
            if (!player1 || !player2) return; // Spieler nicht gefunden

            const matchMatchesFilter = !filter ||
                player1.firstname.toLowerCase().includes(filter) || player1.lastname.toLowerCase().includes(filter) || player1.username.toLowerCase().includes(filter) ||
                player2.firstname.toLowerCase().includes(filter) || player2.lastname.toLowerCase().includes(filter) || player2.username.toLowerCase().includes(filter);

            if(!matchMatchesFilter && filter) return; // Match überspringen

            const result = tournamentData.results[matchId] || { score1: null, score2: null, confirmed: false };
            const timeStr = match.time ? match.time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
            const tableStr = match.table ? `T${match.table}` : '';

            const li = document.createElement('li');
            li.innerHTML = `
                <span>${timeStr} <span class="math-inline">\{tableStr\}</span\> \-
<span>${player1.username}</span> vs
<span>${player2.username}</span>
<span class="match-result">
  ${
    result.score1 !== null && result.score2 !== null
      ? `${result.score1} : ${result.score2} ${result.confirmed ? '✔️' : '❓'}`
      : '-:-'
  }
</span>
<button 
  class="result-btn" 
  data-match-id="${matchId}" 
  ${result.confirmed ? 'disabled' : ''}
>
  Ergebnis
</button>
`;
matchesUl.appendChild(li);
});
groupDiv.appendChild(matchesUl);
                groupStageContainer.appendChild(groupDiv);
    });
}

 function renderKnockoutStage() {
     if(!knockoutStageContainer) return;
     knockoutStageContainer.innerHTML = ''; // Leeren
      const filter = nameFilterInput.value.toLowerCase().trim();

     // Hilfsfunktion zum Rendern einer Runde
     const renderRound = (roundKey, title) => {
         const roundData = tournamentData.knockoutMatches[roundKey];
         const roundDiv = document.getElementById(`ko-round-${roundKey.replace('ko','')}`) || document.createElement('div'); // Finde oder erstelle Container
         roundDiv.innerHTML = `<h4>${title}</h4>`; // Setze Titel immer neu

         if (!roundData || roundData.length === 0) {
             roundDiv.innerHTML += '<p>Spiele werden noch generiert...</p>';
             return roundDiv; // Gebe Div zurück
         }

         roundData.forEach(match => {
             const player1 = match.player1 ? getParticipantById(match.player1) : null;
             const player2 = match.player2 ? getParticipantById(match.player2) : null;

             // Filter anwenden
              const matchMatchesFilter = !filter ||
                   (player1 && (player1.firstname.toLowerCase().includes(filter) || player1.lastname.toLowerCase().includes(filter) || player1.username.toLowerCase().includes(filter))) ||
                   (player2 && (player2.firstname.toLowerCase().includes(filter) || player2.lastname.toLowerCase().includes(filter) || player2.username.toLowerCase().includes(filter)));

              if(!matchMatchesFilter && filter && player1 && player2) return; // Match überspringen, nur wenn Filter aktiv UND beide Spieler bekannt sind


             const result = tournamentData.results[match.matchId] || { score1: null, score2: null, confirmed: false };
             const timeStr = match.time ? match.time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
              const tableStr = match.table ? `T${match.table}` : '';

             const matchDiv = document.createElement('div');
             matchDiv.classList.add('ko-match');
             matchDiv.innerHTML = `
                 <div class="ko-time-table">${timeStr} <span class="math-inline">\{tableStr\}</div\>
                 <div class="ko-players">
  <span>
    ${player1 
      ? player1.username 
      : (match.player1 
        ? '<i>Spieler wird ermittelt</i>' 
        : '<i>TBD</i>')}
  </span>
  <span>
    ${player2 
      ? player2.username 
      : (match.player2 
        ? '<i>Spieler wird ermittelt</i>' 
        : '<i>TBD</i>')}
  </span>
</div>
<div class="ko-result">
  ${
    result.score1 !== null && result.score2 !== null
      ? `${result.score1} : ${result.score2} ${result.confirmed ? '✔️' : '❓'}`
      : '-:-'
  }
</div>
<button 
  class="result-btn" 
  data-match-id="${match.matchId}" 
  ${result.confirmed || !player1 || !player2 ? 'disabled' : ''}
>
  Ergebnis
</button>
`;
roundDiv.appendChild(matchDiv);
});
return roundDiv;
};
// Container im HTML finden oder erstellen
     const bracketContainer = knockoutStageContainer.querySelector('.ko-bracket') || document.createElement('div');
     bracketContainer.className = 'ko-bracket';
     const placementsContainer = knockoutStageContainer.querySelector('.ko-placements') || document.createElement('div');
     placementsContainer.className = 'ko-placements';

      // Runden rendern und an Container anhängen
     if(tournamentData.knockoutMatches.round16) bracketContainer.appendChild(renderRound('round16', 'Sechzehntelfinale'));
     if(tournamentData.knockoutMatches.quarter) bracketContainer.appendChild(renderRound('quarter', 'Viertelfinale'));
     if(tournamentData.knockoutMatches.semi) bracketContainer.appendChild(renderRound('semi', 'Halbfinale'));
     if(tournamentData.knockoutMatches.final) bracketContainer.appendChild(renderRound('final', 'Finale'));

     if(tournamentData.knockoutMatches.place3) placementsContainer.appendChild(renderRound('place3', 'Spiel um Platz 3'));
     if(tournamentData.knockoutMatches.place58_semi) placementsContainer.appendChild(renderRound('place58_semi', 'Platz 5-8 Halbfinale'));
     if(tournamentData.knockoutMatches.place7) placementsContainer.appendChild(renderRound('place7', 'Spiel um Platz 7'));
     if(tournamentData.knockoutMatches.place5) placementsContainer.appendChild(renderRound('place5', 'Spiel um Platz 5'));


     // Sicherstellen, dass Container im DOM sind
     if (!knockoutStageContainer.contains(bracketContainer)) knockoutStageContainer.appendChild(bracketContainer);
     if (!knockoutStageContainer.contains(placementsContainer)) knockoutStageContainer.appendChild(placementsContainer);
 }


// --- Leaderboard ---
// (Hier updateLeaderboard Funktion einfügen)
function updateLeaderboard() {
    if(!leaderboardList) return;
    leaderboardList.innerHTML = ''; // Leeren
    let rankedPlayers = [];

    // Phase 1: Nehme direkt 'participants'
    const currentParticipants = participants.filter(p => p.verified);
    // Phase 2: Würde Teilnehmer aus DB laden

    currentParticipants.forEach(p => {
        let playerInfo = {
            participant: p,
            status: 'Registriert',
            rank: Infinity,
            finalRank: finalRanks[p.id] || null,
            groupInfo: findParticipantGroupInfo(p.id) || { points: 0, pointDiff: 0, rank: Infinity, groupId: 'N/A' },
            progressScore: 0
        };

        // Fortschritt und Status ermitteln (wie im vorherigen Code-Block)
         let highestRoundReached = 0;
         let currentStatus = `Gruppe ${playerInfo.groupInfo.groupId} Rang ${playerInfo.groupInfo.rank || '?'}`;
         playerInfo.progressScore = 100 + (100 - (playerInfo.groupInfo.rank || 100));

         let foundProgress = false;
         for (const roundKey of ['kof', 'ko3p', 'ko5p', 'ko7p', 'kosf', 'koqf', 'ko58sf', 'ko16']) {
             if (!tournamentData.knockoutMatches || !tournamentData.knockoutMatches[roundKey]) continue;

             for (const match of tournamentData.knockoutMatches[roundKey]) {
                 const checkPlayerInMatch = (m) => m && (m.player1 === p.id || m.player2 === p.id);
                 const getPlayerResultInMatch = (m) => {
                     if (!m || !m.result?.confirmed || !checkPlayerInMatch(m)) return 'playing';
                     return m.result.winner === p.id ? 'won' : 'lost';
                 }

                 if (checkPlayerInMatch(match)) {
                     const result = getPlayerResultInMatch(match);
                     const roundScoreValue = getRoundScoreValue(roundKey);

                     if (result === 'won') {
                         playerInfo.progressScore = Math.max(playerInfo.progressScore, roundScoreValue + 1);
                         if (['kof', 'ko3p', 'ko5p', 'ko7p'].includes(roundKey)) {
                              currentStatus = `Abgeschlossen (${finalRanks[p.id]}. Platz)`;
                         } else {
                              const nextMatch = findKnockoutMatchById(match.winnerTo);
                              currentStatus = nextMatch ? `Wartet auf ${nextMatch.type}` : `Gewinner ${roundKey}`;
                         }
                         foundProgress = true; break;
                     } else if (result === 'lost') {
                         playerInfo.progressScore = Math.max(playerInfo.progressScore, roundScoreValue);
                         if (['kof', 'ko3p', 'ko5p', 'ko7p'].includes(roundKey)) {
                              currentStatus = `Abgeschlossen (${finalRanks[p.id]}. Platz)`;
                         } else if (match.loserTo) {
                              const nextMatch = findKnockoutMatchById(match.loserTo);
                              currentStatus = nextMatch ? `Wartet auf ${nextMatch.type}` : `Verlierer ${roundKey}`;
                         } else {
                             currentStatus = `Ausgeschieden in ${roundKey}`;
                         }
                         foundProgress = true; break;
                     } else { // 'playing'
                         playerInfo.progressScore = Math.max(playerInfo.progressScore, roundScoreValue);
                         currentStatus = `Spielend in ${roundKey}`; // (${match.matchId})
                         foundProgress = true; break;
                     }
                 }
             }
             if(foundProgress) break;
         }
         playerInfo.status = currentStatus;

         // Status überschreiben falls finaler Rang existiert
          if (playerInfo.finalRank) {
              playerInfo.status = `Finished ${playerInfo.finalRank}.`;
              playerInfo.progressScore = 10000 - playerInfo.finalRank;
         }

        rankedPlayers.push(playerInfo);
    });

    // Sortieren (wie im vorherigen Code-Block)
    rankedPlayers.sort((a, b) => {
        if (a.finalRank && b.finalRank) return a.finalRank - b.finalRank;
        if (a.finalRank) return -1;
        if (b.finalRank) return 1;
        if (a.progressScore !== b.progressScore) return b.progressScore - a.progressScore;
        const groupA = a.groupInfo || {};
        const groupB = b.groupInfo || {};
        if (groupA.points !== groupB.points) return groupB.points - groupA.points;
        if (groupA.pointDiff !== groupB.pointDiff) return groupB.pointDiff - groupA.pointDiff;
        return a.participant.username.localeCompare(b.participant.username);
    });


    // Anzeigen
    const listContent = document.getElementById('leaderboard-list');
    if(!listContent) return;
    listContent.innerHTML = ''; // Leeren

    if (rankedPlayers.length === 0) {
        listContent.innerHTML = '<li>Noch keine Teilnehmer oder Ergebnisse.</li>';
        return;
    }
    rankedPlayers.forEach((rp, index) => {
        const li = document.createElement('li');
        const displayRank = rp.finalRank ? `${rp.finalRank}.` : `${index + 1}.`;
        li.textContent = `${displayRank} ${rp.participant.firstname} <span class="math-inline">\{rp\.participant\.lastname\} \(</span>{rp.participant.username}) - ${rp.status}`;
        // Optional: Füge hier mehr Details hinzu, wenn gewünscht
        // li.textContent += ` | Grp: P${rp.groupInfo.points} D${rp.groupInfo.pointDiff}`;
        listContent.appendChild(li);
    });
}
// Hilfsfunktion für Wertigkeit der Runden (höher ist besser)
function getRoundScoreValue(roundKey) {
    const scores = { 'ko16': 100, 'koqf': 200, 'ko58sf': 250, 'kosf': 300, 'ko7p': 350, 'ko5p': 360, 'ko3p': 370, 'kof': 400 };
    return scores[roundKey] || 0;
}


// --- Ergebnis-Handling ---
// (Hier handleResultButtonClick, handleResultSubmit, handleConfirmAccept, handleConfirmReject einfügen)
function handleResultButtonClick(event) {
     const matchId = event.target.getAttribute('data-match-id');
     const match = findMatchFromScheduleOrKO(matchId); // Finde Match in schedule oder knockoutMatches
      const result = tournamentData.results[matchId] || { score1: null, score2: null, confirmed: false };

     if (!match || result.confirmed) return;

     const player1 = getParticipantById(match.player1);
     const player2 = getParticipantById(match.player2);
     // Phase 1 Check
     if (!currentUser || (currentUser.id !== player1?.id && currentUser.id !== player2?.id)) {
          alert("Nur beteiligte Spieler können Ergebnisse eintragen.");
          return;
     }
      // Phase 2 Check (wird später aktiviert)
     /*
     if (!currentUserProfile || (currentUserProfile.id !== player1?.id && currentUserProfile.id !== player2?.id)) {
          alert("Nur beteiligte Spieler können Ergebnisse eintragen.");
          return;
     }
     */


     // Zeitprüfung (nur für Gruppenphase relevant hier)
     if (match.type === 'group' && match.time) {
          const now = new Date();
          const matchEndTime = new Date(match.time.getTime() + matchDuration * 60000); // Nur Dauer, keine Pause
          if (now < matchEndTime) {
              alert(`Das Spiel läuft noch oder hat nicht gestartet. Ergebnis kann erst ab ${matchEndTime.toLocaleTimeString()} eingetragen werden.`);
              return;
          }
     }

     // Modal vorbereiten und anzeigen
      const player1NameEl = document.getElementById('player1-name');
      const player2NameEl = document.getElementById('player2-name');
      const matchTimeEl = document.getElementById('match-time');
      const matchTableEl = document.getElementById('match-table');
      const score1El = document.getElementById('score1');
      const score2El = document.getElementById('score2');

      if(player1NameEl) player1NameEl.textContent = player1?.username || 'N/A';
      if(player2NameEl) player2NameEl.textContent = player2?.username || 'N/A';
      if(matchTimeEl) matchTimeEl.textContent = match.time ? match.time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
      if(matchTableEl) matchTableEl.textContent = match.table || '?';
      if(score1El) score1El.value = result.score1 !== null ? result.score1 : '';
      if(score2El) score2El.value = result.score2 !== null ? result.score2 : '';

      showMessage('result-modal-message', '', false); // Nachricht löschen
      resultForm.dataset.currentMatchId = matchId; // Match-ID speichern für Submit

      resultModal.classList.remove('hidden');
 }

function handleResultSubmit(e) {
     e.preventDefault();
     const matchId = resultForm.dataset.currentMatchId;
     const score1Input = document.getElementById('score1');
     const score2Input = document.getElementById('score2');
     const score1 = parseInt(score1Input.value, 10);
     const score2 = parseInt(score2Input.value, 10);

     if (isNaN(score1) || isNaN(score2) || score1 < 0 || score2 < 0) {
          showMessage('result-modal-message', 'Bitte gültige, nicht-negative Punktzahlen eingeben.'); return;
     }

     const match = findMatchFromScheduleOrKO(matchId);
     if (!match) {
         showMessage('result-modal-message', 'Fehler: Match nicht gefunden.'); return;
     }

     // Validierung 1: Kein Unentschieden
     if (score1 === score2) {
         showMessage('result-modal-message', 'Unentschieden sind nicht erlaubt.'); return;
     }

     // Validierung 2: KO-Runden-Regel
     if (match.type !== 'group') {
          const winnerScore = Math.max(score1, score2);
          const loserScore = Math.min(score1, score2);
          if (winnerScore < 21) {
              showMessage('result-modal-message', 'In KO-Runden muss der Gewinner mind. 21 Punkte haben.'); return;
          }
          if (winnerScore === 21 && loserScore > 19) {
              showMessage('result-modal-message', 'Bei 21 Punkten muss der Vorsprung mind. 2 Punkte betragen (z.B. 21:19).'); return;
          }
          if (winnerScore > 21 && winnerScore - loserScore !== 2) {
              showMessage('result-modal-message', 'Bei über 21 Punkten muss der Vorsprung genau 2 Punkte betragen (z.B. 22:20).'); return;
          }
     }

    // Phase 1: Ergebnis direkt speichern (noch nicht bestätigt)
    const currentUserId = currentUser?.id; // Phase 1 User ID
     tournamentData.results[matchId] = {
         score1: score1, score2: score2,
         confirmed: false,
         reportedBy: currentUserId // Phase 1: ID des aktuellen localStorage-Users
     };
     saveData();
     showMessage('result-modal-message', 'Ergebnis gespeichert. Warte auf Bestätigung (simuliert).', true);

      setTimeout(() => {
          resultModal.classList.add('hidden');
          displayTournamentPlan();
          updateLeaderboard();
          // Phase 1 Simulation der Gegner-Bestätigung
          simulateOpponentConfirmation(matchId);
      }, 1500);

      // Phase 2: Würde hier Supabase Update Call machen
      /*
       const currentUserId = currentUserProfile?.id; // Phase 2 User ID
       const { data, error } = await supabase.from('matches').update({
           score1: score1, score2: score2, status: 'reported', reported_by_id: currentUserId
       }).eq('id', matchId); // Annahme: 'id' ist PK
       if (error) { showMessage('result-modal-message', `Fehler: ${error.message}`); }
       else {
           showMessage('result-modal-message', 'Ergebnis übermittelt. Warte auf Bestätigung.', true);
           // Schließe Modal, update UI etc.
           // Starte Echtzeit-Listener für Gegner
       }
      */
 }

 // Phase 1 Simulation der Bestätigung
 function simulateOpponentConfirmation(matchId) {
     const match = findMatchFromScheduleOrKO(matchId);
     const result = tournamentData.results[matchId];
     if (!match || !result || result.confirmed || !match.player1 || !match.player2) return;

     const reporter = getParticipantById(result.reportedBy);
     // Finde den Gegner (Annahme: Der *andere* Spieler im Match)
     const opponentId = (reporter?.id === match.player1) ? match.player2 : match.player1;
     const opponent = getParticipantById(opponentId);
     const player1 = getParticipantById(match.player1);
     const player2 = getParticipantById(match.player2);

     if (!reporter || !opponent || !player1 || !player2) {
        console.warn("Konnte Bestätigung nicht simulieren, Spieler nicht gefunden.");
        return;
     }


     // Zeige das Bestätigungs-Modal (als ob es der Gegner sehen würde)
      const opponentReporterEl = document.getElementById('opponent-reporter');
      const confirmP1NameEl = document.getElementById('confirm-player1-name');
      const confirmP2NameEl = document.getElementById('confirm-player2-name');
      const confirmS1El = document.getElementById('confirm-score1');
      const confirmS2El = document.getElementById('confirm-score2');


      if(opponentReporterEl) opponentReporterEl.textContent = reporter.username;
      if(confirmP1NameEl) confirmP1NameEl.textContent = player1.username;
      if(confirmP2NameEl) confirmP2NameEl.textContent = player2.username;
      if(confirmS1El) confirmS1El.textContent = result.score1;
      if(confirmS2El) confirmS2El.textContent = result.score2;

      showMessage('confirm-modal-message', '', false); // Nachricht löschen
      confirmModal.dataset.currentMatchId = matchId; // Match-ID speichern

     // In Phase 1 zeigen wir es einfach immer an
      console.warn(`Simuliere Bestätigung für ${opponent.username} für Match ${matchId}`);
      confirmModal.classList.remove('hidden');
 }

 function handleConfirmAccept() {
      const matchId = confirmModal.dataset.currentMatchId;
      if (!tournamentData.results[matchId]) return;

      // Phase 1: Direkt bestätigen
      tournamentData.results[matchId].confirmed = true;
      // Finde Gewinner/Verlierer für lokales results Objekt
       const res = tournamentData.results[matchId];
       const match = findMatchFromScheduleOrKO(matchId);
       if(match) {
           res.winner = res.score1 > res.score2 ? match.player1 : match.player2;
           res.loser = res.score1 < res.score2 ? match.player1 : match.player2;
       }

      saveData();
      showMessage('confirm-modal-message', 'Ergebnis bestätigt!', true);

      // Turnierlogik anstossen
      const matchInfo = findMatchFromScheduleOrKO(matchId);
      if (matchInfo?.type === 'group') {
          calculateGroupStandings(matchInfo.groupId); // Gruppe neu berechnen
      } else if (matchInfo) {
          updateKnockoutMatch(matchId); // KO-Baum fortschreiben
      }

      setTimeout(() => {
          confirmModal.classList.add('hidden');
          displayTournamentPlan();
          updateLeaderboard();
      }, 1000);

       // Phase 2: Würde Supabase Update Call machen, onAuthStateChange würde UI updaten
       /*
        const { error } = await supabase.from('matches').update({ status: 'confirmed' }).eq('id', matchId);
         if(error) { showMessage('confirm-modal-message', `Fehler: ${error.message}`); }
         else {
             showMessage('confirm-modal-message', 'Bestätigt!', true);
             // UI Update passiert durch Echtzeit-Listener oder manuelles Refetch
             confirmModal.classList.add('hidden');
             // updateKnockoutMatch(matchId); // Dieser Aufruf MUSS nach Bestätigung erfolgen!
         }
       */
  }

  function handleConfirmReject() {
       const matchId = confirmModal.dataset.currentMatchId;
       if (!tournamentData.results[matchId]) return;

       // Phase 1: Ergebnis löschen / zurücksetzen
       delete tournamentData.results[matchId];
       // Oder Status auf 'disputed' setzen
       // tournamentData.results[matchId].status = 'disputed';
       // tournamentData.results[matchId].confirmed = false;

       saveData();
       showMessage('confirm-modal-message', 'Ergebnis abgelehnt (in Phase 1 zurückgesetzt).', false);
       setTimeout(() => {
            confirmModal.classList.add('hidden');
            displayTournamentPlan();
            updateLeaderboard();
       }, 1500);

        // Phase 2: Würde Status auf 'disputed' setzen, Admin müsste eingreifen
        /*
        const { error } = await supabase.from('matches').update({ status: 'disputed' }).eq('id', matchId);
        if(error) { showMessage('confirm-modal-message', `Fehler: ${error.message}`); }
        else {
             showMessage('confirm-modal-message', 'Ergebnis abgelehnt. Admin wird benachrichtigt (simuliert).', false);
              // UI Update, Modal schliessen
        }
        */
  }

// --- Turnier Logik ---
// (Hier alle Turnierlogik-Funktionen einfügen: calculateGroupStandings, createGroups,
// createGroupMatchesParallel, prepareKnockoutBrackets, seedKnockoutBracket, updateKnockoutMatch,
// assignPlayerToMatch, allQuarterFinalsFinished, storeQuarterFinalLoser, assignFinalRank,
// findParticipantGroupInfo, seed5th8thBracket, scheduleKoMatch, calculateKoStartTimeBase etc.)
// --- Admin Button Handler ---
function handleGenerateTournament() {
    const verifiedParticipants = participants.filter(p=>p.verified);
    if (verifiedParticipants.length < 2) {
        alert("Es müssen mindestens 2 verifizierte Teilnehmer registriert sein."); return;
    }
    if (verifiedParticipants.length > 100) {
        alert("Maximal 100 Teilnehmer erlaubt."); return;
    }
    if(confirm(`Sicher, dass der Turnierplan für ${verifiedParticipants.length} Teilnehmer jetzt generiert werden soll? Bestehende Daten werden überschrieben.`)) {
         // Reset relevanter Daten
         quarterFinalLosers = [];
         finalRanks = {};
         tableAvailableTimes = Array(12).fill(null);
         lastKoMatchStartTime = null;
         tournamentData = { groups: [], knockoutMatches: {}, schedule: [], results: {} }; // Reset

         generateTournamentSchedule();
         alert("Turnierplan wurde generiert.");
    }
}
function handleSeedKo() {
     // Prüfen ob Gruppenphase abgeschlossen ist (alle Ergebnisse bestätigt)
     const allGroupMatches = tournamentData.schedule.filter(m => m.type === 'group');
     const allConfirmed = allGroupMatches.every(m => tournamentData.results[m.matchId]?.confirmed);

     if (!allConfirmed) {
         alert("Die Gruppenphase ist noch nicht abgeschlossen. Bitte erst alle Ergebnisse bestätigen.");
         return;
     }

    if(confirm("Sicher, dass die KO-Runde jetzt basierend auf den Gruppenergebnissen gesetzt werden soll?")) {
        // Stelle sicher, dass alle Gruppenstände berechnet wurden
        tournamentData.groups.forEach(g => calculateGroupStandings(g.id));
        seedKnockoutBracket(); // Diese Funktion muss existieren und KO Matches erstellen/füllen
        alert("KO-Runde wurde gesetzt und erste Spiele geplant.");
    }
}


// --- Turnier Logik Funktionen ---
function calculateGroupStandings(groupId) {
    const group = tournamentData.groups.find(g => g.id === groupId);
    if (!group) return null;

    const groupResults = {};
    group.players.forEach(pId => {
         groupResults[pId] = { points: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0, gamesPlayed: 0 };
    });

    group.matches.forEach(matchId => {
        const result = tournamentData.results[matchId];
        const match = findMatchFromScheduleOrKO(matchId); // Nutze neue Suchfunktion

        if (result && result.confirmed && match) {
            const p1 = match.player1;
            const p2 = match.player2;
            const s1 = result.score1;
            const s2 = result.score2;

            // Addiere nur, wenn Spieler existiert
            if(groupResults[p1]) {
                groupResults[p1].gamesPlayed++;
                groupResults[p1].pointsFor += s1;
                groupResults[p1].pointsAgainst += s2;
                groupResults[p1].pointDiff = groupResults[p1].pointsFor - groupResults[p1].pointsAgainst;
            }
             if(groupResults[p2]) {
                groupResults[p2].gamesPlayed++;
                groupResults[p2].pointsFor += s2;
                groupResults[p2].pointsAgainst += s1;
                groupResults[p2].pointDiff = groupResults[p2].pointsFor - groupResults[p2].pointsAgainst;
             }


            if (s1 > s2) {
                if(groupResults[p1]) { groupResults[p1].points += 3; groupResults[p1].wins++; }
                if(groupResults[p2]) { groupResults[p2].losses++; }
            } else {
                if(groupResults[p2]) { groupResults[p2].points += 3; groupResults[p2].wins++; }
                if(groupResults[p1]) { groupResults[p1].losses++; }
            }
        }
    });

    let playerStandings = group.players.map(pId => ({
        id: pId,
        ...groupResults[pId] // Füge berechnete Werte hinzu
    })).filter(p=> p.id); // Filtere evtl. ungültige Einträge


    playerStandings.sort((a, b) => {
         if (a.points !== b.points) return b.points - a.points; // 1. Punkte

         const tiedPlayers = playerStandings.filter(p => p.points === a.points).map(p => p.id);

         if (tiedPlayers.length === 2) { // 2a. Direkter Vergleich
             const h2hMatch = findMatchBetweenPlayers(a.id, b.id, group.matches);
             if (h2hMatch && h2hMatch.result?.confirmed) {
                  return h2hMatch.result.winner === a.id ? -1 : 1; // Gewinner kommt zuerst
             }
         } else if (tiedPlayers.length > 2) { // 2b. Mini-Tabelle
              const miniTablePointsA = calculateMiniTablePoints(a.id, tiedPlayers, group.matches);
              const miniTablePointsB = calculateMiniTablePoints(b.id, tiedPlayers, group.matches);
              if (miniTablePointsA !== miniTablePointsB) {
                  return miniTablePointsB - miniTablePointsA;
              }
         }
          // 3. Punktedifferenz
         if (a.pointDiff !== b.pointDiff) return b.pointDiff - a.pointDiff;
         // 4. Erzielte Punkte
         if (a.pointsFor !== b.pointsFor) return b.pointsFor - a.pointsFor;
         // 5. Los (simuliert durch ID)
         return a.id.localeCompare(b.id);
    });

    // Ränge zuweisen
    playerStandings.forEach((p, index) => {
        p.rank = index + 1;
         if (index > 0) { // Ranggleichheit prüfen
             const prev = playerStandings[index-1];
             if (p.points === prev.points && p.pointDiff === prev.pointDiff && p.pointsFor === prev.pointsFor /* && direkter Vergleich/Mini-Tabelle gleich */) {
                 // Exakte Kriterien für Ranggleichheit hier prüfen
                 // Vereinfacht: Wir weisen erstmal fortlaufende Ränge zu
             }
         }
    });

     // Speichere standings direkt in der Gruppe für einfachen Zugriff
     group.standings = playerStandings;
     // saveData(); // Speichern nach Berechnung - kann zu viel werden, besser gezielt speichern

    return playerStandings;
}

function calculateMiniTablePoints(playerId, tiedPlayerIds, groupMatchIds) {
     let points = 0;
     groupMatchIds.forEach(matchId => {
         const match = findMatchFromScheduleOrKO(matchId);
         if (match && tiedPlayerIds.includes(match.player1) && tiedPlayerIds.includes(match.player2)) {
             const result = tournamentData.results[matchId];
             if (result && result.confirmed) {
                 if (match.player1 === playerId && result.score1 > result.score2) points += 3;
                 if (match.player2 === playerId && result.score2 > result.score1) points += 3;
             }
         }
     });
     return points;
}

function findMatchBetweenPlayers(p1Id, p2Id, matchIdList) {
     for (const matchId of matchIdList) {
        const match = findMatchFromScheduleOrKO(matchId);
         if (match && ((match.player1 === p1Id && match.player2 === p2Id) || (match.player1 === p2Id && match.player2 === p1Id))) {
             // Füge Ergebnis direkt hinzu, wenn verfügbar
              match.result = tournamentData.results[matchId];
              return match;
         }
     }
     return null;
}


 function generateTournamentSchedule() {
     const verifiedParticipants = participants.filter(p => p.verified);
     if (verifiedParticipants.length < 2) return;

     tournamentData.groups = createGroups(verifiedParticipants, 6);
     tournamentData.schedule = createGroupMatchesParallel(tournamentData.groups, startTime, matchDuration, breakDuration, 12);

     const numQualifiers = tournamentData.groups.length * 2;
     tournamentData.knockoutMatches = prepareKnockoutBrackets(numQualifiers);

     // Ergebnisse initialisieren
     tournamentData.results = {};
     tournamentData.schedule.forEach(match => {
         tournamentData.results[match.matchId] = { score1: null, score2: null, confirmed: false, reportedBy: null, winner: null, loser: null };
     });
      // KO-Matches haben ihr 'result' Objekt schon (in prepareKnockoutBrackets)
      // Stelle sicher, dass sie auch im globalen results-Objekt sind
      Object.values(tournamentData.knockoutMatches).flat().forEach(match => {
          if (!tournamentData.results[match.matchId]) {
               tournamentData.results[match.matchId] = match.result;
          }
      });

     console.log("Turnierplan generiert:", tournamentData);
     saveData();
     displayTournamentPlan();
 }

 function createGroups(players, maxSize) {
    const shuffledPlayers = [...players].sort(() => 0.5 - Math.random());
    const groups = [];
    let groupIndex = 0;
    for (let i = 0; i < shuffledPlayers.length; i += maxSize) {
        const groupPlayers = shuffledPlayers.slice(i, i + maxSize);
        groups.push({
            id: String.fromCharCode(65 + groupIndex++), // A, B, C...
            players: groupPlayers.map(p => p.id),
            matches: [],
            standings: [] // Initial leere Standings
        });
    }
    return groups;
}

 function createGroupMatchesParallel(groups, tournamentStartTime, gameTime, pauseTime, numTables) {
     const schedule = [];
     let matchCounter = 1;
     const localTableAvailableTimes = Array(numTables).fill(new Date(tournamentStartTime.getTime()));
     let groupMatchList = [];

     groups.forEach(group => {
         const playerIds = group.players;
         const groupMatches = [];
         for (let i = 0; i < playerIds.length; i++) {
             for (let j = i + 1; j < playerIds.length; j++) {
                  const matchId = `G${group.id}-M${matchCounter++}`;
                  groupMatches.push(matchId);
                  groupMatchList.push({
                      matchId: matchId, player1: playerIds[i], player2: playerIds[j],
                      type: 'group', groupId: group.id
                  });
              }
          }
          group.matches = groupMatches;
     });

     groupMatchList.forEach(matchInfo => {
         let earliestTableIndex = 0;
         for (let i = 1; i < numTables; i++) {
             if (localTableAvailableTimes[i] < localTableAvailableTimes[earliestTableIndex]) {
                 earliestTableIndex = i;
             }
         }
         const matchStartTime = new Date(localTableAvailableTimes[earliestTableIndex].getTime());
         const matchEndTime = new Date(matchStartTime.getTime() + (gameTime + pauseTime) * 60000);
         localTableAvailableTimes[earliestTableIndex] = matchEndTime;

         schedule.push({
             ...matchInfo,
             time: matchStartTime,
             table: earliestTableIndex + 1
         });
     });

     schedule.sort((a, b) => a.time - b.time);
     return schedule;
 }

 function prepareKnockoutBrackets(numberOfQualifiers) {
     const knockoutMatches = { /* round16, quarter, semi, final, place3, place58_semi, place5, place7 */ };
     let matchCounter = 1;

     const createKoMatch = (typePrefix, winnerTo = null, loserTo = null) => ({
         matchId: `KO-<span class="math-inline">\{typePrefix\}\-M</span>{matchCounter++}`,
         player1: null, player2: null, type: typePrefix,
         winnerTo: winnerTo, loserTo: loserTo,
         time: null, table: null,
         result: { score1: null, score2: null, confirmed: false, reportedBy: null, winner: null, loser: null }
     });

      // Erstelle Struktur basierend auf Qualifikantenanzahl (hier nur für 16 gezeigt)
     if (numberOfQualifiers >= 16) {
         knockoutMatches.round16 = Array.from({ length: 8 }, (_, i) => createKoMatch('ko16'));
         knockoutMatches.quarter = Array.from({ length: 4 }, () => createKoMatch('koqf'));
         knockoutMatches.semi = Array.from({ length: 2 }, () => createKoMatch('kosf'));
         knockoutMatches.final = [createKoMatch('kof')];
         knockoutMatches.place3 = [createKoMatch('ko3p')];
         knockoutMatches.place58_semi = Array.from({ length: 2 }, () => createKoMatch('ko58sf'));
         knockoutMatches.place5 = [createKoMatch('ko5p')];
         knockoutMatches.place7 = [createKoMatch('ko7p')];

         // Verknüpfungen setzen (Beispiele)
         knockoutMatches.round16.forEach((m, i) => m.winnerTo = knockoutMatches.quarter[Math.floor(i/2)].matchId);
         knockoutMatches.quarter.forEach((m, i) => {
             m.winnerTo = knockoutMatches.semi[Math.floor(i/2)].matchId;
             m.loserTo = knockoutMatches.place58_semi[Math.floor(i/2)].matchId;
         });
         knockoutMatches.semi.forEach((m, i) => {
             m.winnerTo = knockoutMatches.final[0].matchId;
             m.loserTo = knockoutMatches.place3[0].matchId;
         });
          knockoutMatches.place58_semi.forEach((m, i) => {
              m.winnerTo = knockoutMatches.place5[0].matchId;
              m.loserTo = knockoutMatches.place7[0].matchId;
          });
     }
     // TODO: Logik für andere Anzahlen von Qualifikanten hinzufügen

     return knockoutMatches;
 }

function seedKnockoutBracket() {
     console.log("Seeding KO bracket...");
     const qualifiers = {};
     let seedingPossible = true;

     tournamentData.groups.forEach(group => {
         if (!group.standings || group.standings.length < 2) {
              console.warn(`Gruppe ${group.id} hat keine vollständigen Standings. Seeding unvollständig.`);
              seedingPossible = false;
         } else {
            qualifiers[`${group.id}1`] = group.standings[0].id;
            qualifiers[`${group.id}2`] = group.standings[1].id;
         }
     });

     if (!seedingPossible) {
         alert("Seeding nicht möglich, da nicht alle Gruppen abgeschlossen sind oder weniger als 2 Spieler haben.");
         return;
     }

     const numGroups = tournamentData.groups.length;
      // Annahme: Mindestens 8 Gruppen für das Standard-Schema
     if (numGroups < 8 || !tournamentData.knockoutMatches.round16 || tournamentData.knockoutMatches.round16.length !== 8) {
          alert("KO Seeding Schema für diese Gruppenanzahl nicht implementiert oder KO-Struktur passt nicht.");
          console.error("KO Seeding Error: Gruppenanzahl oder KO-Struktur inkompatibel.");
          return;
     }

     const pairings16 = [ /* Wie vorher definiert */
         { p1Key: 'A1', p2Key: 'B2' }, { p1Key: 'C1', p2Key: 'D2' }, { p1Key: 'E1', p2Key: 'F2' }, { p1Key: 'G1', p2Key: 'H2' },
         { p1Key: 'B1', p2Key: 'A2' }, { p1Key: 'D1', p2Key: 'C2' }, { p1Key: 'F1', p2Key: 'E2' }, { p1Key: 'H1', p2Key: 'G2' }
     ];

     let koMatchesScheduled = false;
     pairings16.forEach((pair, index) => {
         const match = tournamentData.knockoutMatches.round16[index];
         match.player1 = qualifiers[pair.p1Key] || null;
         match.player2 = qualifiers[pair.p2Key] || null;

         if (match.player1 && match.player2 && !match.time) {
              scheduleKoMatch(match); // Plane das Match, wenn beide Spieler bekannt sind
              koMatchesScheduled = true;
         } else if(!match.player1 || !match.player2) {
             console.warn(`Match ${match.matchId} konnte nicht voll besetzt werden. Keys: ${pair.p1Key}, ${pair.p2Key}`);
         }
     });

     saveData();
     console.log("KO Round 16 seeded:", tournamentData.knockoutMatches.round16);
     displayTournamentPlan(); // UI Update
     if (koMatchesScheduled) {
        console.log("Erste KO-Spiele wurden geplant.");
     }
 }

  function seed5th8thBracket() { /* Wie vorher definiert */
     if (quarterFinalLosers.length !== 4) { return; }
     quarterFinalLosers.sort((a, b) => {
         if (a.score !== b.score) return b.score - a.score;
         return b.groupPoints - a.groupPoints;
     });
     const semi1 = tournamentData.knockoutMatches.place58_semi[0];
     const semi2 = tournamentData.knockoutMatches.place58_semi[1];
     assignPlayerToMatch(semi1, quarterFinalLosers[0].playerId);
     assignPlayerToMatch(semi1, quarterFinalLosers[3].playerId);
     assignPlayerToMatch(semi2, quarterFinalLosers[1].playerId);
     assignPlayerToMatch(semi2, quarterFinalLosers[2].playerId);
     scheduleKoMatch(semi1);
     scheduleKoMatch(semi2);
     saveData();
     displayTournamentPlan();
  }


  function updateKnockoutMatch(matchId) { /* Wie vorher definiert */
     let completedMatch = findMatchFromScheduleOrKO(matchId); // Finde Match
     if (!completedMatch || !completedMatch.result || !completedMatch.result.confirmed) { return; }
     const { winnerId, loserId } = determineWinnerLoser(completedMatch); // Bestimme W/L
     completedMatch.result.winner = winnerId; // Speichere W/L im Ergebnis
     completedMatch.result.loser = loserId;
     // Gewinner weiterschicken
     if (completedMatch.winnerTo) {
        const nextMatch = findKnockoutMatchById(completedMatch.winnerTo);
        if (nextMatch) {
            assignPlayerToMatch(nextMatch, winnerId);
            if (nextMatch.player1 && nextMatch.player2 && !nextMatch.time) scheduleKoMatch(nextMatch);
        }
     } else { assignFinalRank(winnerId, completedMatch.type, true); }
     // Verlierer behandeln
     if (completedMatch.loserTo) {
         const loserMatch = findKnockoutMatchById(completedMatch.loserTo);
         if (loserMatch) {
             if (completedMatch.type === 'koqf') { storeQuarterFinalLoser(loserId, completedMatch.result.score1 === Math.min(completedMatch.result.score1, completedMatch.result.score2) ? completedMatch.result.score1 : completedMatch.result.score2); }
             else { assignPlayerToMatch(loserMatch, loserId); if (loserMatch.player1 && loserMatch.player2 && !loserMatch.time) scheduleKoMatch(loserMatch); }
         }
     } else { if (completedMatch.type !== 'ko16') assignFinalRank(loserId, completedMatch.type, false); }
     // Check für 5-8 Seeding
     if (completedMatch.type === 'koqf' && allQuarterFinalsFinished()) { seed5th8thBracket(); }
     saveData();
     displayTournamentPlan();
     updateLeaderboard();
   }


 // --- Hilfsfunktionen für KO-Logik ---
 function assignPlayerToMatch(match, playerId) { /* Wie vorher */
    if (!match) return;
    if (!match.player1) match.player1 = playerId;
    else if (!match.player2) match.player2 = playerId;
    else console.error(`Match ${match.matchId} already full.`);
 }
  function allQuarterFinalsFinished() { /* Wie vorher */
    if (!tournamentData.knockoutMatches?.quarter) return false;
    return tournamentData.knockoutMatches.quarter.every(m => m.result?.confirmed);
  }
 function storeQuarterFinalLoser(playerId, score) { /* Wie vorher */
    if (!quarterFinalLosers.some(l => l.playerId === playerId)) {
         const groupInfo = findParticipantGroupInfo(playerId);
         quarterFinalLosers.push({ playerId, score, groupPoints: groupInfo?.points || 0 });
    }
  }
 function assignFinalRank(playerId, matchType, isWinner) { /* Wie vorher */
     let rank = null;
     switch (matchType) {
         case 'kof': rank = isWinner ? 1 : 2; break; case 'ko3p': rank = isWinner ? 3 : 4; break;
         case 'ko5p': rank = isWinner ? 5 : 6; break; case 'ko7p': rank = isWinner ? 7 : 8; break;
     }
     if (rank !== null && !finalRanks[playerId]) finalRanks[playerId] = rank;
  }
 function findParticipantGroupInfo(playerId) { /* Wie vorher, mit Caching/Berechnung */
      for (const group of tournamentData.groups) {
         if (!group.standings && group.matches.every(mid => tournamentData.results[mid]?.confirmed)) { calculateGroupStandings(group.id); }
         if (group.standings) { const standing = group.standings.find(s => s.id === playerId); if (standing) { standing.groupId = group.id; return standing; } }
      } return null;
  }
  function determineWinnerLoser(match) { // Neue Hilfsfunktion
       if (!match?.result?.confirmed) return { winnerId: null, loserId: null };
       const { score1, score2, player1, player2 } = match; // Annahme: player1/2 IDs sind im Match Objekt
       const result = match.result;
       const winnerId = result.score1 > result.score2 ? player1 : player2;
       const loserId = result.score1 < result.score2 ? player1 : player2;
       return { winnerId, loserId };
  }
  // Funktion um Match in schedule ODER knockoutMatches zu finden
  function findMatchFromScheduleOrKO(matchId) {
       let match = tournamentData.schedule.find(m => m.matchId === matchId);
       if (match) return match;
       for (const roundKey in tournamentData.knockoutMatches) {
            const round = tournamentData.knockoutMatches[roundKey];
            if (Array.isArray(round)) {
                match = round.find(m => m.matchId === matchId);
                if (match) return match;
            }
       }
       return null;
  }


// --- Zeitplanungs-Funktionen ---
// (Hier scheduleKoMatch und calculateKoStartTimeBase einfügen)
function scheduleKoMatch(match) {
    if (!match || !match.player1 || !match.player2 || match.time) { return; }
    let earliestPossibleStart = calculateKoStartTimeBase();
    if (lastKoMatchStartTime && earliestPossibleStart < lastKoMatchStartTime) {
        earliestPossibleStart = new Date(lastKoMatchStartTime.getTime());
    }
    if (tableAvailableTimes.every(t => t === null)) {
        tableAvailableTimes.fill(earliestPossibleStart);
    }
    let bestTableIndex = 0;
    for (let i = 1; i < tableAvailableTimes.length; i++) {
        if (tableAvailableTimes[i] < tableAvailableTimes[bestTableIndex]) {
            bestTableIndex = i;
        }
    }
    const assignedTime = new Date(Math.max(earliestPossibleStart.getTime(), tableAvailableTimes[bestTableIndex].getTime()));
    match.time = assignedTime;
    match.table = bestTableIndex + 1;
    const finishTime = new Date(assignedTime.getTime() + (KO_MATCH_DURATION_MIN + KO_BREAK_DURATION_MIN) * 60000);
    tableAvailableTimes[bestTableIndex] = finishTime;
    lastKoMatchStartTime = new Date(assignedTime.getTime());
    console.log(`SCHEDULED: Match ${match.matchId} at <span class="math-inline">\{match\.time\.toLocaleTimeString\(\)\} on T</span>{match.table}`);
    // saveData(); // Besser gezielt speichern
}

function calculateKoStartTimeBase() {
    let lastGroupFinishTime = new Date(startTime.getTime());
    tournamentData.schedule.forEach(match => {
        if (match.type === 'group' && match.time) {
            const groupMatchEndTime = new Date(match.time.getTime() + (matchDuration + breakDuration) * 60000);
            if (groupMatchEndTime > lastGroupFinishTime) lastGroupFinishTime = groupMatchEndTime;
        }
    });
    const koStartTimeBase = new Date(lastGroupFinishTime.getTime() + BUFFER_AFTER_GROUP_MIN * 60000);
    const minutes = koStartTimeBase.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 5) * 5;
    koStartTimeBase.setMinutes(roundedMinutes, 0, 0);
    return koStartTimeBase;
}


// --- Hilfsfunktionen für Event Listener ---
// Füge hier die Handler ein, die oben referenziert wurden (handleRegister, handleLogin, handleVerify, etc.)
// ... und alle weiteren Hilfsfunktionen ...


// --- Initialen Aufruf ---
// Wird jetzt von DOMContentLoaded am Anfang aufgerufen.

```
