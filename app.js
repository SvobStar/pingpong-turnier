// --- Supabase Initialisierung ---
const SUPABASE_URL = 'https://tleekgcafugywbhfwpky.supabase.co'; // Deine URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRsZWVrZ2NhZnVneXdiaGZ3cGt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2MzEzNTcsImV4cCI6MjA2MDIwNzM1N30.UgWOr-rGY17YL11gghJmEg_HUkMscnEf-pPe0gY4Jwk'; // Dein Key

// Initialisiere den Supabase Client mit einem *anderen* Variablennamen
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Globale Zustandsvariablen ---
let currentSession = null; // Hält die Supabase Auth Session
let currentUserProfile = null; // Hält das Profil des Users aus der 'profiles' Tabelle
let currentTournamentData = { // Lokaler Cache für Turnierdaten (wird von Supabase geladen)
    matches: [], // Enthält Match-Objekte aus der DB
    participants: [], // Enthält Profil-Objekte der Teilnehmer
    groups: {}, // Struktur zur Organisation der Gruppen (client-seitig generiert)
    knockoutMatches: {} // Struktur für KO-Baum (client-seitig generiert)
};
let activeMatchListeners = {}; // Hält aktive Realtime Listener { matchId: channel }

// Konstanten (bleiben gleich)
const startTime = new Date();
startTime.setHours(13, 30, 0, 0);
const matchDuration = 7;
const breakDuration = 3;
const KO_MATCH_DURATION_MIN = 25;
const KO_BREAK_DURATION_MIN = 5;
const BUFFER_AFTER_GROUP_MIN = 15;
let finalRanks = {}; // { profileId: rank } - Wird jetzt aus Match-Daten abgeleitet
let quarterFinalLosers = []; // [{ profileId: id, score: scoreInLostQF, groupPoints: points }]

// --- DOM Elemente holen ---
// (Alle getElementById wie zuvor...)
const authScreen = document.getElementById('auth-screen');
const mainScreen = document.getElementById('main-screen');
const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const verifyScreen = document.getElementById('verify-screen'); // Wird evtl. nicht mehr gebraucht, wenn E-Mail Bestätigung aus ist
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
const adminPanel = document.getElementById('admin-panel');

// Modal Elemente
const resultModal = document.getElementById('result-modal');
const confirmModal = document.getElementById('confirm-modal');
const closeResultModalBtn = resultModal.querySelector('.close-btn');
const closeConfirmModalBtn = confirmModal.querySelector('.close-confirm-btn');
const resultForm = document.getElementById('result-form');
const confirmAcceptBtn = document.getElementById('confirm-result-accept-btn');
const confirmRejectBtn = document.getElementById('confirm-result-reject-btn');

// --- Kernfunktionen (Auth, Daten laden, UI) ---

// Wird bei Login/Logout aufgerufen
supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    if (session && currentSession?.user?.id !== session.user.id) { // Nur bei echtem Wechsel oder erstem Laden
        console.log('Auth State Changed: User logged in', session.user.id);
        currentSession = session;
        await loadUserProfile(session.user.id); // Lade Profil aus 'profiles' Tabelle
        await loadInitialTournamentData(); // Lade Matches etc.
    } else if (!session && currentSession) { // Nur wenn vorher eingeloggt
        console.log('Auth State Changed: User logged out');
        currentSession = null;
        currentUserProfile = null;
        currentTournamentData = { matches: [], participants: [], groups: {}, knockoutMatches: {} }; // Reset Cache
        unsubscribeAllRealtime(); // Listener abmelden
    } else if (session && !currentUserProfile) {
        // User ist eingeloggt, aber Profil wurde noch nicht geladen (z.B. nach Refresh)
        console.log('Auth State Stable: User logged in, reloading profile/data');
        currentSession = session;
        await loadUserProfile(session.user.id);
        await loadInitialTournamentData();
    }
    // Update die UI basierend auf dem neuen Zustand
    setupInitialView();
});

// Lädt das Benutzerprofil aus der 'profiles' Tabelle
async function loadUserProfile(userId) {
    console.log(`Attempting to load profile for user ID: ${userId}`);
    try { // Füge try...catch hinzu für bessere Fehlerbehandlung
        const { data, error, status } = await supabaseClient // <--- KORRIGIERT!
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error && status !== 406) throw error; // Fehler werfen, wenn nicht "not found"

        if (data) {
            currentUserProfile = data;
            console.log('User profile loaded:', currentUserProfile);
        } else {
            currentUserProfile = null;
            console.log('No profile found for user:', userId);
        }
    } catch (error) {
         console.error('Error loading user profile:', error);
         currentUserProfile = null;
         // Zeige dem User evtl. eine Fehlermeldung, dass Profildaten nicht geladen werden konnten
         showUserMessage(`Fehler beim Laden der Benutzerdaten: ${error.message}`, 'error', 0);
    }
}

// Lädt initiale Turnierdaten (Matches, Teilnehmer)
async function loadInitialTournamentData() {
    console.log("Loading initial tournament data...");
    // Lade alle Matches für das (aktuelle) Turnier
    // Annahme: Es gibt nur ein Turnier oder eine ID ist bekannt
    const { data: matchesData, error: matchesError } = await supabaseClient
        .from('matches')
        .select('*'); // Später evtl. filtern nach Turnier-ID

    if (matchesError) {
        console.error('Error loading matches:', matchesError);
        currentTournamentData.matches = [];
    } else {
        currentTournamentData.matches = matchesData || [];
        console.log(`Loaded ${currentTournamentData.matches.length} matches.`);
        // Konvertiere Timestamps aus DB (ISO String) in Date Objekte
        currentTournamentData.matches.forEach(m => {
            if (m.scheduled_time) m.time = new Date(m.scheduled_time); // Füge JS Date Objekt hinzu
        });
    }

    // Lade alle Teilnehmer-Profile (könnte später optimiert werden)
    const { data: profilesData, error: profilesError } = await supabaseClient
        .from('profiles')
        .select('*'); // Hole alle Profile

    if (profilesError) {
        console.error('Error loading participants:', profilesError);
        currentTournamentData.participants = [];
    } else {
        currentTournamentData.participants = profilesData || [];
         console.log(`Loaded ${currentTournamentData.participants.length} participants.`);
    }

    // Bereite Gruppen und KO-Struktur clientseitig vor (basierend auf geladenen Matches)
    rebuildClientSideTournamentStructure();
    // Starte Echtzeit-Listener für unbestätigte Spiele des aktuellen Users
    subscribeToRelevantMatches();

    // Update UI nach Laden der Daten
    displayTournamentOverview();
    displayTournamentPlan(); // Stellt sicher, dass Plan gerendert wird, falls aktiv
    updateLeaderboard();
}

// Baut die clientseitigen Strukturen (groups, knockoutMatches) aus der Match-Liste auf
function rebuildClientSideTournamentStructure() {
    currentTournamentData.groups = {};
    currentTournamentData.knockoutMatches = {};

    currentTournamentData.matches.forEach(match => {
        // Ergebnis-Objekt extrahieren (falls in DB gespeichert)
        match.result = {
            score1: match.score1, score2: match.score2,
            confirmed: match.status === 'confirmed',
            reportedBy: match.reported_by_id,
            winner: match.winner_id, loser: match.loser_id
        };

        if (match.type === 'group' && match.group_id) {
            if (!currentTournamentData.groups[match.group_id]) {
                currentTournamentData.groups[match.group_id] = {
                    id: match.group_id,
                    players: new Set(), // Verwende Set für eindeutige Spieler
                    matches: []
                };
            }
            currentTournamentData.groups[match.group_id].matches.push(match.id); // Annahme: `id` ist PK von matches
            if (match.player1_id) currentTournamentData.groups[match.group_id].players.add(match.player1_id);
            if (match.player2_id) currentTournamentData.groups[match.group_id].players.add(match.player2_id);
        } else if (match.round_type) { // KO-Match
            const roundKey = match.round_type; // z.B. 'ko16', 'koqf'
            if (!currentTournamentData.knockoutMatches[roundKey]) {
                currentTournamentData.knockoutMatches[roundKey] = [];
            }
            // Füge Match hinzu, falls noch nicht vorhanden (um Duplikate zu vermeiden)
             if (!currentTournamentData.knockoutMatches[roundKey].some(m => m.id === match.id)) {
                 // Hier fehlt die winnerTo/loserTo Info aus der DB - muss ggf. mitgeladen werden!
                 // Füge Match mit seinen DB-Daten hinzu
                 currentTournamentData.knockoutMatches[roundKey].push({
                      ...match, // Alle Daten aus der DB
                      matchId: match.id // Einheitliche ID verwenden
                 });
             }
        }
    });

    // Konvertiere Set in Array für Gruppen-Spieler
    Object.values(currentTournamentData.groups).forEach(group => {
        group.players = Array.from(group.players);
        // Berechne Standings für jede Gruppe basierend auf geladenen Matches
        calculateGroupStandings(group.id);
    });

    console.log("Client-side structure rebuilt:", {
        groups: currentTournamentData.groups,
        knockoutMatches: currentTournamentData.knockoutMatches
    });
}


// Steuert die initiale UI-Anzeige
function setupInitialView() {
    if (currentSession && currentUserProfile) { // Prüfe beides!
        showScreen(mainScreen);
        displayTournamentOverview(); // Zeige standardmässig Overview
        // Ggf. Namen im Header anzeigen
        // document.getElementById('profile-btn').textContent = currentUserProfile.username || '👤';
    } else {
        showScreen(authScreen);
        showAuthForm(null); // Zeige nur Login/Register Buttons
    }
}

// Zeigt/versteckt Haupt- oder Auth-Bildschirm
function showScreen(screenToShow) {
    authScreen.classList.add('hidden');
    mainScreen.classList.add('hidden');
    if (screenToShow) {
        screenToShow.classList.remove('hidden');
    }
}

// Zeigt spezifisches Formular im Auth-Bildschirm
function showAuthForm(formToShow) {
    registerForm.classList.add('hidden');
    loginForm.classList.add('hidden');
    verifyScreen.classList.add('hidden'); // Verification Screen nicht mehr benötigt
    if (formToShow) {
        formToShow.classList.remove('hidden');
    }
}

// Zeigt Nachrichten an (Fehler oder Erfolg)
function showMessage(elementId, text, isSuccess = false) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text;
        element.className = isSuccess ? 'message success' : 'message error'; // Klassen setzen
    }
}

// Holt Teilnehmerdaten aus dem lokalen Cache
function getParticipantById(profileId) {
    if (!profileId) return null;
    return currentTournamentData.participants.find(p => p.id === profileId);
}


// --- Authentifizierungs-Handler (Phase 2 - Supabase) ---

async function handleRegister(e) {
    e.preventDefault();
    const registerButton = e.target.querySelector('button[type="submit"]');
    setLoadingState(registerButton, true, "Registriere...");
    // Wähle das korrekte Nachrichtenfeld im Registrierungsformular
    const messageElementId = 'register-message'; // ID des <p> Tags im Register-Formular
    showMessage(messageElementId, '', false); // Alte Nachrichten löschen

    // Hole Formulardaten
    const firstName = document.getElementById('register-firstname').value.trim();
    const lastName = document.getElementById('register-lastname').value.trim();
    const username = document.getElementById('register-username').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const phone = document.getElementById('register-phone').value.trim();
    const password = document.getElementById('register-password').value;

    // Validierungen
    if (!firstName || !lastName || !username || !email || !phone || !password || password.length < 6) {
        showMessage(messageElementId, 'Bitte alle Felder korrekt ausfüllen (Passwort mind. 6 Zeichen).');
        setLoadingState(registerButton, false);
        return;
    }

    try {
        // Supabase signUp Aufruf
        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    username: username,
                    firstname: firstName,
                    lastname: lastName,
                    phone: phone
                }
            }
        });

        if (error) {
            // Fehlerfall
            console.error("Signup Error:", error);
            // Zeige Fehler im Nachrichtenfeld des Formulars an
            showMessage(messageElementId, `Registrierungsfehler: ${error.message}`);
        } else {
            // Erfolgsfall
            console.log("Signup successful:", data);
            // Klare Nachricht für den User, da Bestätigung aktiviert ist
            showUserMessage('Registrierung fast abgeschlossen! Bitte prüfe dein E-Mail Postfach (' + email + ') und klicke auf den Bestätigungslink, um den Vorgang abzuschliessen.', 'success', 10000); // Längere Anzeige im Haupt-Nachrichtenbereich

            registerForm.reset(); // Formular leeren
            showAuthForm(loginForm); // Zum Login-Formular wechseln
        }

    } catch (error) {
        // Fängt Fehler ab, falls schon der await-Aufruf selbst fehlschlägt
        console.error("Signup Exception:", error);
        showMessage(messageElementId, `Ein unerwarteter Fehler ist aufgetreten: ${error.message}`);
    } finally {
        // Wird immer ausgeführt, egal ob Erfolg oder Fehler
        setLoadingState(registerButton, false); // Ladezustand des Buttons beenden
    }
} // Ende der handleRegister Funktion

async function handleLogin(e) {
    e.preventDefault();
    const loginIdentifier = document.getElementById('login-username').value.trim(); // E-Mail oder Username? Annahme: E-Mail
    const password = document.getElementById('login-password').value;

    showMessage('login-message', 'Anmeldung wird geprüft...', false);

    // Versuche Login mit E-Mail
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: loginIdentifier,
        password: password,
    });

    // TODO: Wenn Login per E-Mail fehlschlägt, könnte man versuchen, den User anhand des Usernamens
    // in der 'profiles' Tabelle zu finden und dann dessen E-Mail für den Login zu verwenden.
    // Erfordert eine zusätzliche Abfrage.

    if (error) {
        console.error("Login Error:", error);
        showMessage('login-message', `Login fehlgeschlagen: ${error.message}`);
    } else {
        console.log("Login successful:", data);
        showMessage('login-message', 'Login erfolgreich!', true);
        // UI wird durch onAuthStateChange aktualisiert, sobald Profil geladen ist
    }
}

async function handleLogout() {
    console.log("Logging out...");
    unsubscribeAllRealtime(); // Wichtig: Listener abmelden
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error("Logout Error:", error);
        alert(`Logout fehlgeschlagen: ${error.message}`);
    } else {
        console.log("Logout successful");
        // UI wird durch onAuthStateChange aktualisiert
    }
}

// --- UI Update Funktionen ---

function updateTournamentOverview() {
    const today = new Date();
    const formattedDate = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth() + 1).toString().padStart(2, '0')}.${today.getFullYear()}`;
    if (eventDateElement) eventDateElement.textContent = formattedDate;
    updateLeaderboard(); // Ruft die neue Leaderboard-Funktion auf
}

function displayTournamentOverview() {
    tournamentOverview.classList.remove('hidden');
    tournamentPlan.classList.add('hidden');
    updateLeaderboard();
}

function displayTournamentPlan() {
    tournamentPlan.classList.remove('hidden');
    tournamentOverview.classList.add('hidden'); // Verstecke Overview, wenn Plan angezeigt wird
    if (!currentTournamentData || !currentTournamentData.matches) {
        console.error("Turnierdaten (Matches) nicht verfügbar für Anzeige.");
        groupStageContainer.innerHTML = '<p>Turnierdaten werden geladen...</p>';
        knockoutStageContainer.innerHTML = '';
        return;
    }
    // Rendere Gruppen und KO basierend auf den Daten in currentTournamentData
    renderGroupStage();
    renderKnockoutStage();
    addResultButtonListeners(); // Füge Listener *nach* dem Rendern hinzu
}

// --- Rendering Funktionen (leicht angepasst für Profil-Daten) ---

function renderGroupStage() {
    if (!groupStageContainer) return;
    groupStageContainer.innerHTML = '';
    const filter = nameFilterInput.value.toLowerCase().trim();

    // Iteriere über die clientseitig erstellte Gruppenstruktur
    const groups = Object.values(currentTournamentData.groups);

    if (groups.length === 0) {
        groupStageContainer.innerHTML = "<p>Noch keine Gruppen vorhanden.</p>";
        return;
    }

    groups.sort((a,b) => a.id.localeCompare(b.id)); // Sortiere Gruppen A, B, C...

    groups.forEach(group => {
        // Standings sollten schon berechnet sein in rebuildClientSideTournamentStructure
        const standings = group.standings || [];
        const groupPlayers = group.players.map(getParticipantById).filter(p => p); // Hole Profile

        // Filterung (wie vorher) ...
         const groupMatchesFilter = !filter || groupPlayers.some(p =>
               (p.firstname && p.firstname.toLowerCase().includes(filter)) ||
               (p.lastname && p.lastname.toLowerCase().includes(filter)) ||
               (p.username && p.username.toLowerCase().includes(filter))
         );
         if (!groupMatchesFilter && filter) return;


        const groupDiv = document.createElement('div');
        groupDiv.classList.add('group');
        groupDiv.innerHTML = `<h4>Gruppe ${group.id}</h4>`;

        // Tabelle mit Standings rendern
        const table = document.createElement('table');
        table.innerHTML = `<thead><tr><th>#</th><th>Spieler</th><th>Pkt</th><th>+/-</th><th>Sp</th></tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        standings.forEach((standing, index) => {
            const player = getParticipantById(standing.id); // Hole Profil
            if (player) {
                tbody.innerHTML += `<tr>
                    <td>${standing.rank || (index + 1)}</td>
                    <td>${player.firstname || ''} ${player.lastname || ''} (${player.username || 'N/A'})</td>
                    <td>${standing.points ?? 0}</td>
                    <td>${(standing.pointDiff ?? 0) > 0 ? '+' : ''}${standing.pointDiff ?? 0}</td>
                    <td>${standing.gamesPlayed ?? 0}</td>
                </tr>`;
            }
        });
        groupDiv.appendChild(table);

        // Matches der Gruppe rendern
        const matchesUl = document.createElement('ul');
        matchesUl.classList.add('match-list');
        // Finde die Matches für diese Gruppe in den globalen Daten
        const groupMatchObjects = currentTournamentData.matches.filter(m => m.type === 'group' && m.group_id === group.id);
        groupMatchObjects.sort((a,b) => (a.time || 0) - (b.time || 0)); // Sortiere nach Zeit

        groupMatchObjects.forEach(match => {
            const player1 = getParticipantById(match.player1_id);
            const player2 = getParticipantById(match.player2_id);
            if (!player1 || !player2) return; // Überspringe, falls Spieler nicht geladen

             // Filterung für Match (wie vorher) ...
            const matchMatchesFilter = !filter ||
                 (player1.firstname && player1.firstname.toLowerCase().includes(filter)) || (player1.lastname && player1.lastname.toLowerCase().includes(filter)) || (player1.username && player1.username.toLowerCase().includes(filter)) ||
                 (player2.firstname && player2.firstname.toLowerCase().includes(filter)) || (player2.lastname && player2.lastname.toLowerCase().includes(filter)) || (player2.username && player2.username.toLowerCase().includes(filter));
             if(!matchMatchesFilter && filter) return;

            const result = match.result || { score1: null, score2: null, confirmed: false };
            const timeStr = match.time ? match.time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
            const tableStr = match.table_number ? `T${match.table_number}` : '';

            const li = document.createElement('li');
            li.innerHTML = `
                <span>${timeStr} ${tableStr}</span> -
                <span>${player1.username || 'N/A'}</span> vs
                <span>${player2.username || 'N/A'}</span>
                <span class="match-result">${result.score1 !== null ? `${result.score1} : ${result.score2} ${result.confirmed ? '✔️' : '❓'}` : '-:-'}</span>
                <button class="result-btn" data-match-id="${match.id}" ${result.confirmed ? 'disabled' : ''}>Ergebnis</button>
            `;
            matchesUl.appendChild(li);
        });
        groupDiv.appendChild(matchesUl);
        groupStageContainer.appendChild(groupDiv);
    });
}

function renderKnockoutStage() {
    if (!knockoutStageContainer) return;
    knockoutStageContainer.innerHTML = '';
    const filter = nameFilterInput.value.toLowerCase().trim();

    const renderRound = (roundKey, title) => {
        const roundData = currentTournamentData.knockoutMatches[roundKey];
        const roundDiv = document.createElement('div'); // Immer neu erstellen
        roundDiv.className = 'ko-round';
        roundDiv.id = `ko-round-${roundKey}`;
        roundDiv.innerHTML = `<h4>${title}</h4>`;

        if (!roundData || roundData.length === 0) {
            roundDiv.innerHTML += '<p>Spiele werden noch generiert/geladen...</p>';
            return roundDiv;
        }

        // Sortiere Matches innerhalb der Runde (optional, z.B. nach ID oder geplanter Zeit)
         roundData.sort((a,b) => a.matchId.localeCompare(b.matchId)); // Einfache Sortierung nach ID

        roundData.forEach(match => {
            const player1 = match.player1_id ? getParticipantById(match.player1_id) : null;
            const player2 = match.player2_id ? getParticipantById(match.player2_id) : null;

             // Filterung (wie vorher) ...
             const matchMatchesFilter = !filter ||
                   (player1 && ((player1.firstname && player1.firstname.toLowerCase().includes(filter)) || (player1.lastname && player1.lastname.toLowerCase().includes(filter)) || (player1.username && player1.username.toLowerCase().includes(filter)))) ||
                   (player2 && ((player2.firstname && player2.firstname.toLowerCase().includes(filter)) || (player2.lastname && player2.lastname.toLowerCase().includes(filter)) || (player2.username && player2.username.toLowerCase().includes(filter))));
              if(!matchMatchesFilter && filter && (player1 || player2)) return; // Überspringe nur, wenn Filter aktiv und mind. ein Spieler bekannt ist


            const result = match.result || { score1: null, score2: null, confirmed: false };
            const timeStr = match.time ? match.time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
            const tableStr = match.table_number ? `T${match.table_number}` : '';

            const matchDiv = document.createElement('div');
            matchDiv.classList.add('ko-match');
            matchDiv.innerHTML = `
                <div class="ko-time-table">${timeStr} ${tableStr}</div>
                <div class="ko-players">
                    <span>${player1 ? player1.username : (match.player1_id ? '<i>Wartet auf Spieler</i>' : '<i>TBD</i>')}</span>
                    <span>${player2 ? player2.username : (match.player2_id ? '<i>Wartet auf Spieler</i>' : '<i>TBD</i>')}</span>
                </div>
                <div class="ko-result">${result.score1 !== null ? `${result.score1} : ${result.score2} ${result.confirmed ? '✔️' : '❓'}` : '-:-'}</div>
                <button class="result-btn" data-match-id="${match.id}" ${result.confirmed || !player1 || !player2 ? 'disabled' : ''}>Ergebnis</button>
            `;
            roundDiv.appendChild(matchDiv);
        });
        return roundDiv;
    };

    const bracketContainer = document.createElement('div');
    bracketContainer.className = 'ko-bracket';
    const placementsContainer = document.createElement('div');
    placementsContainer.className = 'ko-placements';

    // Rendere vorhandene Runden
    if (currentTournamentData.knockoutMatches.round16) bracketContainer.appendChild(renderRound('round16', 'Sechzehntelfinale'));
    if (currentTournamentData.knockoutMatches.quarter) bracketContainer.appendChild(renderRound('quarter', 'Viertelfinale'));
    if (currentTournamentData.knockoutMatches.semi) bracketContainer.appendChild(renderRound('semi', 'Halbfinale'));
    if (currentTournamentData.knockoutMatches.final) bracketContainer.appendChild(renderRound('final', 'Finale'));

    if (currentTournamentData.knockoutMatches.place3) placementsContainer.appendChild(renderRound('place3', 'Spiel um Platz 3'));
    if (currentTournamentData.knockoutMatches.place58_semi) placementsContainer.appendChild(renderRound('place58_semi', 'Platz 5-8 Halbfinale'));
    if (currentTournamentData.knockoutMatches.place7) placementsContainer.appendChild(renderRound('place7', 'Spiel um Platz 7'));
    if (currentTournamentData.knockoutMatches.place5) placementsContainer.appendChild(renderRound('place5', 'Spiel um Platz 5'));

    knockoutStageContainer.appendChild(bracketContainer);
    knockoutStageContainer.appendChild(placementsContainer);
}

// --- Leaderboard (Phase 2 - Nutzt aktuelle Daten) ---
async function updateLeaderboard() {
    if (!leaderboardList) return;
    leaderboardList.innerHTML = '<li>Lade Leaderboard...</li>';

    // Hole die neuesten Daten, falls nötig, oder verwende Cache
    // Fürs Erste verwenden wir den Cache currentTournamentData.participants und currentTournamentData.matches
    const participantsProfiles = currentTournamentData.participants;
    const allMatches = currentTournamentData.matches;

    let rankedPlayers = [];

    participantsProfiles.forEach(p => {
        let playerInfo = {
            participant: p, // Enthält id, username, firstname, lastname etc.
            status: 'Registriert',
            rank: Infinity,
            finalRank: null, // Wird später aus Match-Ergebnissen bestimmt
            groupInfo: findParticipantGroupInfo(p.id) || { points: 0, pointDiff: 0, rank: Infinity, groupId: 'N/A' },
            progressScore: 0
        };

        // Finde finalen Rang, falls vorhanden (z.B. durch Abfrage der Matches-Tabelle nach winner/loser in Finalspielen)
        // TODO: Logik zur Ermittlung des finalen Rangs aus den Match-Daten implementieren
        // playerInfo.finalRank = calculateFinalRankFromMatches(p.id, allMatches);

        // Fortschritt und Status ermitteln (ähnlich wie Phase 1, aber mit DB-Daten)
        // Diese Logik muss ggf. die `allMatches`-Liste durchsuchen
        // ... (Detail-Logik zur Statusermittlung hier einfügen) ...

        rankedPlayers.push(playerInfo);
    });

    // Sortieren (wie vorher, aber mit Daten aus playerInfo)
    rankedPlayers.sort((a, b) => {
        if (a.finalRank && b.finalRank) return a.finalRank - b.finalRank;
        if (a.finalRank) return -1;
        if (b.finalRank) return 1;
        if (a.progressScore !== b.progressScore) return b.progressScore - a.progressScore;
        const groupA = a.groupInfo || {};
        const groupB = b.groupInfo || {};
        if (groupA.points !== groupB.points) return groupB.points - groupA.points;
        if (groupA.pointDiff !== groupB.pointDiff) return groupB.pointDiff - groupA.pointDiff;
        return (a.participant.username || '').localeCompare(b.participant.username || '');
    });

    // Anzeigen
    leaderboardList.innerHTML = ''; // Leeren
    if (rankedPlayers.length === 0) {
        leaderboardList.innerHTML = '<li>Keine Teilnehmer gefunden.</li>';
        return;
    }
    rankedPlayers.forEach((rp, index) => {
        const li = document.createElement('li');
        const displayRank = rp.finalRank ? `${rp.finalRank}.` : `${index + 1}.`;
        li.textContent = `${displayRank} ${rp.participant.firstname || ''} ${rp.participant.lastname || ''} (${rp.participant.username || 'N/A'}) - ${rp.status}`;
        leaderboardList.appendChild(li);
    });
}


// --- Ergebnis-Handling (Phase 2 - Supabase) ---

// Wird aufgerufen, wenn User auf "Ergebnis" klickt
function handleResultButtonClick(event) {
    const matchId = event.target.getAttribute('data-match-id'); // Dies ist jetzt der UUID Primary Key aus der DB
    const match = currentTournamentData.matches.find(m => m.id === matchId);

    if (!match || match.status === 'confirmed') {
        console.log("Match nicht gefunden oder bereits bestätigt.");
        return;
    }

    const player1 = getParticipantById(match.player1_id);
    const player2 = getParticipantById(match.player2_id);

    // Prüfe, ob der aktuelle User beteiligt ist
    if (!currentUserProfile || (currentUserProfile.id !== match.player1_id && currentUserProfile.id !== match.player2_id)) {
        alert("Nur beteiligte Spieler können Ergebnisse eintragen.");
        return;
    }

    // Zeitprüfung (optional, wie vorher) ...

    // Modal vorbereiten
    // (DOM-Elemente holen wie zuvor)
    document.getElementById('player1-name').textContent = player1?.username || 'N/A';
    document.getElementById('player2-name').textContent = player2?.username || 'N/A';
    document.getElementById('match-time').textContent = match.time ? match.time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    document.getElementById('match-table').textContent = match.table_number || '?';
    document.getElementById('score1').value = match.score1 ?? ''; // Nutze DB-Werte, falls vorhanden
    document.getElementById('score2').value = match.score2 ?? '';

    showMessage('result-modal-message', '', false);
    resultForm.dataset.currentMatchId = matchId; // UUID speichern

    resultModal.classList.remove('hidden');
}

// Wird aufgerufen, wenn Ergebnis-Formular abgesendet wird
async function handleResultSubmit(e) {
    e.preventDefault();
    const matchId = resultForm.dataset.currentMatchId;
    const score1 = parseInt(document.getElementById('score1').value, 10);
    const score2 = parseInt(document.getElementById('score2').value, 10);
    const currentUserId = currentUserProfile?.id;

    if (!currentUserId) {
        showMessage('result-modal-message', 'Fehler: Nicht angemeldet.'); return;
    }
    if (!matchId) {
        showMessage('result-modal-message', 'Fehler: Match-ID fehlt.'); return;
    }

    // Validierungen (wie vorher: kein Unentschieden, KO-Regeln) ...
    const match = currentTournamentData.matches.find(m => m.id === matchId);
     if (!match) { showMessage('result-modal-message', 'Fehler: Match nicht gefunden.'); return; }
     if (score1 === score2) { showMessage('result-modal-message', 'Unentschieden sind nicht erlaubt.'); return; }
     if (match.round_type !== 'group') { /* KO-Regel Prüfung */
        const winnerScore = Math.max(score1, score2); const loserScore = Math.min(score1, score2);
        if (winnerScore < 21 || (winnerScore === 21 && loserScore > 19) || (winnerScore > 21 && winnerScore - loserScore !== 2)) {
            showMessage('result-modal-message', 'Ungültiges Ergebnis für KO-Runde (21 Punkte, 2 Vorsprung).'); return;
        }
     }


    showMessage('result-modal-message', 'Ergebnis wird übermittelt...', false);

    // Update in Supabase DB
    const { data, error } = await supabaseClient
        .from('matches')
        .update({
            score1: score1,
            score2: score2,
            status: 'reported', // Ergebnis gemeldet
            reported_by_id: currentUserId
        })
        .eq('id', matchId)
        .select() // Wichtig: .select() um das Ergebnis zurückzubekommen (optional)
        .single(); // Annahme: Nur ein Match wird geupdated

    if (error) {
        console.error("Error updating match result:", error);
        showMessage('result-modal-message', `Fehler beim Speichern: ${error.message}`);
    } else {
        console.log("Match result reported:", data);
        showMessage('result-modal-message', 'Ergebnis übermittelt. Warte auf Bestätigung.', true);
        // Update lokaler Cache (optional, Realtime sollte das auch tun)
        const matchIndex = currentTournamentData.matches.findIndex(m => m.id === matchId);
        if (matchIndex !== -1) {
             currentTournamentData.matches[matchIndex].score1 = score1;
             currentTournamentData.matches[matchIndex].score2 = score2;
             currentTournamentData.matches[matchIndex].status = 'reported';
             currentTournamentData.matches[matchIndex].reported_by_id = currentUserId;
             currentTournamentData.matches[matchIndex].result = { ...currentTournamentData.matches[matchIndex].result, score1, score2, reportedBy: currentUserId, confirmed: false };
        }
        // Schließe Modal und update UI
        setTimeout(() => {
            resultModal.classList.add('hidden');
            displayTournamentPlan(); // UI mit '❓' aktualisieren
            // Kein simulateOpponentConfirmation mehr nötig, Realtime übernimmt
        }, 1500);
    }
}

// --- Echtzeit Listener & Bestätigungs-Logik ---

// Wird aufgerufen, wenn eine Match-Änderung von Supabase kommt
function handleRealtimeMatchUpdate(payload) {
    console.log('Realtime: Match Update received:', payload);
    const changedMatch = payload.new;
    const oldMatchData = payload.old; // Kann nützlich sein zum Vergleichen

    // 1. Update den lokalen Match-Cache
    const matchIndex = currentTournamentData.matches.findIndex(m => m.id === changedMatch.id);
    if (matchIndex !== -1) {
        // Füge Zeit wieder als Date Objekt hinzu
        const timeObj = changedMatch.scheduled_time ? new Date(changedMatch.scheduled_time) : null;
        // Update das gesamte Match-Objekt im Cache
        currentTournamentData.matches[matchIndex] = { ...changedMatch, time: timeObj };
         // Aktualisiere das eingebettete result-Objekt
         currentTournamentData.matches[matchIndex].result = {
             score1: changedMatch.score1, score2: changedMatch.score2,
             confirmed: changedMatch.status === 'confirmed',
             reportedBy: changedMatch.reported_by_id,
             winner: changedMatch.winner_id, loser: changedMatch.loser_id
         };

    } else {
        // Füge neues Match hinzu (sollte selten vorkommen bei UPDATE)
        const timeObj = changedMatch.scheduled_time ? new Date(changedMatch.scheduled_time) : null;
        currentTournamentData.matches.push({ ...changedMatch, time: timeObj });
    }

    // 2. Prüfe, ob Bestätigungs-Modal für den aktuellen User angezeigt werden soll
    if (changedMatch.status === 'reported' && currentUserProfile) {
        const reporterId = changedMatch.reported_by_id;
        const player1Id = changedMatch.player1_id;
        const player2Id = changedMatch.player2_id;
        const myId = currentUserProfile.id;

        // Bin ich der Gegner des Reporters?
        if (reporterId !== myId && (player1Id === myId || player2Id === myId)) {
            console.log(`Realtime: Confirmation needed for match ${changedMatch.id}`);
            showConfirmModal(changedMatch); // Zeige das Modal mit den neuen Daten
        }
    }

    // 3. Prüfe, ob ein Match bestätigt wurde -> Turnierlogik anstossen
    if (changedMatch.status === 'confirmed') {
         // Finde heraus, ob dieses Update das Match von 'reported' auf 'confirmed' geändert hat
         // (Manchmal kommen Updates doppelt)
         const previousStatus = oldMatchData?.status; // Benötigt `old` record in payload
         if (previousStatus !== 'confirmed') {
            console.log(`Realtime: Match ${changedMatch.id} confirmed. Updating tournament logic.`);
            // Turnierlogik für bestätigtes Ergebnis anstossen
             if (changedMatch.round_type === 'group') {
                 // Neuberechnung der Gruppe verzögern oder hier machen
                 calculateGroupStandings(changedMatch.group_id);
             } else {
                 // updateKnockoutMatch(changedMatch.id); // Funktion muss DB-Daten verwenden!
                 // Besser: Signal senden, dass KO-Update nötig ist, oder direkt DB-basierte Logik aufrufen
                 triggerKnockoutUpdate(changedMatch.id); // Eigene Funktion definieren
             }
         }
         // Schließe ggf. noch offenes Bestätigungs-Modal für dieses Match
          if (confirmModal.dataset.currentMatchId === changedMatch.id && !confirmModal.classList.contains('hidden')) {
              confirmModal.classList.add('hidden');
          }
    }


    // 4. UI neu rendern, um Änderungen anzuzeigen
    // Debounce oder throttle dies, um bei vielen Updates nicht zu überlasten
    requestAnimationFrame(() => {
         displayTournamentPlan();
         updateLeaderboard();
    });

}

// Zeigt das Bestätigungs-Modal
function showConfirmModal(matchData) {
    const reporter = getParticipantById(matchData.reported_by_id);
    const player1 = getParticipantById(matchData.player1_id);
    const player2 = getParticipantById(matchData.player2_id);

    if (!reporter || !player1 || !player2) {
        console.error("Cannot show confirm modal, participant data missing.");
        return;
    }

    // Fülle Modal-Felder
    document.getElementById('opponent-reporter').textContent = reporter.username || 'N/A';
    document.getElementById('confirm-player1-name').textContent = player1.username || 'N/A';
    document.getElementById('confirm-player2-name').textContent = player2.username || 'N/A';
    document.getElementById('confirm-score1').textContent = matchData.score1 ?? '?';
    document.getElementById('confirm-score2').textContent = matchData.score2 ?? '?';

    showMessage('confirm-modal-message', '', false);
    confirmModal.dataset.currentMatchId = matchData.id; // Match UUID speichern

    confirmModal.classList.remove('hidden');
}

// Handler für "Akzeptieren" im Bestätigungs-Modal
async function handleConfirmAccept() {
    const matchId = confirmModal.dataset.currentMatchId;
    if (!matchId || !currentUserProfile) return;

    showMessage('confirm-modal-message', 'Bestätigung wird gesendet...', false);

    // Update Status in Supabase auf 'confirmed'
    const { data, error } = await supabaseClient
        .from('matches')
        .update({ status: 'confirmed' })
        .eq('id', matchId)
        .eq('status', 'reported'); // Nur updaten, wenn es noch 'reported' ist
        // Optional: Prüfen, ob der aktuelle User der Gegner ist (via RLS Policy in Supabase empfohlen!)

    if (error) {
        console.error("Error confirming match:", error);
        showMessage('confirm-modal-message', `Fehler: ${error.message}`);
    } else {
        console.log("Match confirmed via button:", matchId);
        showMessage('confirm-modal-message', 'Ergebnis bestätigt!', true);
        // Schließe Modal nach kurzer Verzögerung
        setTimeout(() => {
            confirmModal.classList.add('hidden');
            // UI Update geschieht durch Realtime Listener
        }, 1000);
    }
}

// Handler für "Ablehnen" im Bestätigungs-Modal
async function handleConfirmReject() {
    const matchId = confirmModal.dataset.currentMatchId;
    if (!matchId || !currentUserProfile) return;

    showMessage('confirm-modal-message', 'Ablehnung wird gesendet...', false);

    // Update Status in Supabase auf 'disputed'
    const { data, error } = await supabaseClient
        .from('matches')
        .update({ status: 'disputed' }) // Status auf "umstritten"
        .eq('id', matchId)
        .eq('status', 'reported');
        // Optional: RLS Policy Prüfung

    if (error) {
        console.error("Error rejecting match:", error);
        showMessage('confirm-modal-message', `Fehler: ${error.message}`);
    } else {
        console.log("Match rejected:", matchId);
        showMessage('confirm-modal-message', 'Ergebnis abgelehnt. Ein Admin muss dies prüfen.', false);
         setTimeout(() => {
            confirmModal.classList.add('hidden');
             // UI Update geschieht durch Realtime Listener
        }, 1500);
    }
}


// --- Echtzeit-Subscriptions ---

// Startet Listener für relevante Matches
function subscribeToRelevantMatches() {
    if (!currentUserProfile) return; // Geht nur, wenn User eingeloggt ist

    unsubscribeAllRealtime(); // Alte Listener entfernen

    console.log("Subscribing to realtime updates...");

    // Listener für ALLE Match-Updates (einfacher Ansatz)
    // Besser: Filtern nach Matches, an denen der User beteiligt ist oder die offen sind
    const allMatchesChannel = supabaseClient.channel('public-matches')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'matches' }, // Höre auf INSERT, UPDATE, DELETE
          handleRealtimeMatchUpdate // Rufe zentrale Handler-Funktion auf
      )
      .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
              console.log('Realtime channel "public-matches" connected!');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.error('Realtime channel error:', status, err);
              // Ggf. Reconnect-Logik
          } else {
               console.log('Realtime channel status:', status);
          }
      });

    activeMatchListeners['all'] = allMatchesChannel; // Speichern zum Abmelden

    // Zukünftig hier spezifischere Listener hinzufügen, z.B. nur für offene Bestätigungen
}

// Stoppt alle aktiven Realtime Listener
function unsubscribeAllRealtime() {
    console.log("Unsubscribing from all realtime channels...");
    const channels = Object.values(activeMatchListeners);
    if (channels.length > 0) {
        supabaseClient.removeChannel(...channels) // Entferne alle gespeicherten Channels
            .then(() => console.log("Successfully unsubscribed from channels."))
            .catch(err => console.error("Error unsubscribing:", err));
    }
    activeMatchListeners = {}; // Reset
}


// --- Turnierlogik (muss Supabase-Daten verwenden!) ---

// Beispiel: Gruppen generieren (schreibt in DB!)
async function generateGroupsAndMatches() {
    // 1. Hole alle Profile (Teilnehmer) aus der DB
    const { data: profiles, error: profileError } = await supabaseClient.from('profiles').select('id');
    if (profileError || !profiles || profiles.length < 2) {
         alert("Fehler beim Laden der Teilnehmer oder zu wenige Teilnehmer.");
         return false;
    }
    const verifiedParticipants = profiles.map(p => ({ id: p.id })); // Brauchen nur die IDs

    // 2. Erstelle Gruppen-Struktur (wie createGroups Funktion)
    const groups = createGroups(verifiedParticipants, 6); // Gibt [{id: 'A', players: [id1, id2], ...}]

    // 3. Erstelle Match-Einträge für die DB
    const matchesToInsert = [];
    const scheduleTime = new Date(startTime.getTime()); // Startzeit
    let tableCounter = 0;

    groups.forEach(group => {
        const playerIds = group.players;
        for (let i = 0; i < playerIds.length; i++) {
            for (let j = i + 1; j < playerIds.length; j++) {
                 matchesToInsert.push({
                     // id: generiert DB automatisch (uuid)
                     round_type: 'group',
                     group_id: group.id,
                     player1_id: playerIds[i],
                     player2_id: playerIds[j],
                     scheduled_time: new Date(scheduleTime.getTime()), // Zeit zuweisen
                     table_number: (tableCounter % 12) + 1,
                     status: 'scheduled'
                 });
                 // Zeit für nächstes Spiel an diesem Tisch erhöhen
                 scheduleTime.setMinutes(scheduleTime.getMinutes() + matchDuration + breakDuration);
                 tableCounter++; // Nächsten Tisch nehmen (vereinfachte Zuweisung)
             }
         }
    });

    // 4. Füge Matches in Supabase ein
    console.log(`Inserting ${matchesToInsert.length} group matches...`);
    const { data: insertedMatches, error: insertError } = await supabaseClient
        .from('matches')
        .insert(matchesToInsert)
        .select(); // Gib die eingefügten Matches zurück

    if (insertError) {
        console.error("Error inserting group matches:", insertError);
        alert(`Fehler beim Erstellen der Gruppenspiele: ${insertError.message}`);
        return false;
    }

    console.log("Group matches inserted:", insertedMatches);
     // 5. Lade Daten neu, um die Änderungen zu sehen
     await loadInitialTournamentData();
     return true; // Erfolg
}

// Beispiel: KO-Runde Seeden (liest aus DB, schreibt in DB)
async function seedKnockoutBracketFromDB() {
    console.log("Seeding KO bracket from DB data...");

    // 1. Berechne Gruppen-Standings (liest Match-Daten aus Cache/DB)
     const groupStandings = {};
     const groupIds = Object.keys(currentTournamentData.groups);
     for(const groupId of groupIds) {
         groupStandings[groupId] = calculateGroupStandings(groupId); // Nutzt Cache/DB-Daten
         if (!groupStandings[groupId] || groupStandings[groupId].length < 2) {
              alert(`Fehler: Gruppe ${groupId} nicht abgeschlossen oder zu wenige Spieler.`);
              return false; // Abbruch
         }
     }

    // 2. Extrahiere Qualifikanten
     const qualifiers = {};
     groupIds.forEach(gid => {
          qualifiers[`${gid}1`] = groupStandings[gid][0].id;
          qualifiers[`${gid}2`] = groupStandings[gid][1].id;
     });

    // 3. Erstelle KO Match-Objekte für die DB (Struktur wie prepareKnockoutBrackets)
     // Annahme: prepareKnockoutBrackets erstellt nur die Struktur, nicht die DB-Einträge
     const koStructure = prepareKnockoutBrackets(groupIds.length * 2); // Erzeugt leere Struktur mit Verknüpfungen
     const koMatchesToInsert = [];
     const koMatchMap = {}; // Zum Speichern der neu generierten UUIDs für Verknüpfungen

     // Zuerst alle Matches ohne winner/loserTo erstellen
     Object.keys(koStructure).forEach(roundKey => {
         koStructure[roundKey].forEach(matchTemplate => {
             const newMatch = {
                 // id: wird von DB generiert
                 round_type: matchTemplate.type,
                 status: 'scheduled', // Noch nicht gespielt
                 // player1_id, player2_id initial null
             };
             koMatchesToInsert.push(newMatch);
             // Merke dir das Template für spätere Verknüpfung anhand einer temporären ID
             koMatchMap[matchTemplate.matchId] = newMatch; // matchId ist hier die temporäre ID aus prepareKnockoutBrackets
         });
     });

    // Füge die KO-Matches in die DB ein
    const { data: insertedKoMatches, error: insertKoError } = await supabaseClient
        .from('matches')
        .insert(koMatchesToInsert)
        .select(); // Wichtig: Hole die generierten IDs zurück!

     if (insertKoError || !insertedKoMatches) {
          console.error("Error inserting KO matches:", insertKoError);
          alert("Fehler beim Erstellen der KO-Spiele.");
          return false;
     }
     console.log("KO Match structure inserted:", insertedKoMatches);

    // Ordne die zurückgegebenen Matches (mit IDs) den temporären IDs zu
     insertedKoMatches.forEach((dbMatch, index) => {
         const originalMatch = koMatchMap[koMatchesToInsert[index].matchId]; // Finde das ursprüngliche Template
         originalMatch.dbId = dbMatch.id; // Speichere die echte DB-ID
         originalMatch.dbData = dbMatch; // Speichere alle DB-Daten
     });


     // Jetzt die Verknüpfungen (winnerTo, loserTo) und Spieler in der DB aktualisieren
     const updates = [];
      Object.keys(koStructure).forEach(roundKey => {
          koStructure[roundKey].forEach(matchTemplate => {
               const dbId = matchTemplate.dbId;
               if (!dbId) return; // Sollte nicht passieren

               const updatePayload = {};
               // Finde die DB-IDs der Folge-Matches
               if (matchTemplate.winnerTo && koMatchMap[matchTemplate.winnerTo]?.dbId) {
                    updatePayload.winner_to_match_id = koMatchMap[matchTemplate.winnerTo].dbId;
               }
               if (matchTemplate.loserTo && koMatchMap[matchTemplate.loserTo]?.dbId) {
                    updatePayload.loser_to_match_id = koMatchMap[matchTemplate.loserTo].dbId;
               }
                // Füge Spieler für die erste Runde (round16) hinzu
               if (roundKey === 'round16') {
                    // Finde Paarung basierend auf matchTemplate oder Index
                     const pairing = findPairingForMatch(matchTemplate); // Hilfsfunktion nötig
                     if (pairing) {
                          updatePayload.player1_id = qualifiers[pairing.p1Key] || null;
                          updatePayload.player2_id = qualifiers[pairing.p2Key] || null;
                     }
               }

               if (Object.keys(updatePayload).length > 0) {
                    updates.push(supabaseClient.from('matches').update(updatePayload).eq('id', dbId));
               }
          });
      });

      // Führe alle Updates aus
      const results = await Promise.all(updates);
      const errors = results.filter(res => res.error);
      if (errors.length > 0) {
           console.error("Error updating KO match links/players:", errors);
           alert("Fehler beim Verknüpfen der KO-Spiele.");
           return false;
      }

      console.log("KO Bracket seeded and linked in DB.");
       // Daten neu laden und erste Spiele planen
       await loadInitialTournamentData();
       // scheduleInitialKoMatches(); // Funktion, die die ersten KO-Spiele plant
       return true;
}


// --- Turnierlogik (Beispiele angepasst) ---

// Muss jetzt asynchron sein und DB-Daten verwenden
async function triggerKnockoutUpdate(confirmedMatchId) {
    console.log(`Triggering KO update based on match ${confirmedMatchId}`);
    // 1. Lade das bestätigte Match und das nächste Match für Gewinner/Verlierer
    const { data: completedMatchData, error: fetchError } = await supabaseClient
        .from('matches')
        .select('*, player1:player1_id(*), player2:player2_id(*), winner:winner_id(*), loser:loser_id(*)') // Hole verknüpfte Profile
        .eq('id', confirmedMatchId)
        .single();

    if (fetchError || !completedMatchData) {
        console.error(`Error fetching confirmed match ${confirmedMatchId}:`, fetchError);
        return;
    }

     // Stelle sicher, dass Spieler-IDs vorhanden sind
     completedMatchData.player1_id = completedMatchData.player1?.id || completedMatchData.player1_id;
     completedMatchData.player2_id = completedMatchData.player2?.id || completedMatchData.player2_id;


    // 2. Bestimme Gewinner/Verlierer (sollte schon in DB stehen, aber zur Sicherheit)
    const winnerId = completedMatchData.winner_id;
    const loserId = completedMatchData.loser_id;

    if (!winnerId || !loserId) {
        console.error(`Winner/Loser missing for confirmed match ${confirmedMatchId}`);
        // Evtl. hier berechnen und DB updaten?
        return;
    }

    const updates = []; // Sammle DB Update Promises

    // 3. Gewinner weiterschicken
    if (completedMatchData.winner_to_match_id) {
        const nextMatchId = completedMatchData.winner_to_match_id;
        // Finde heraus, ob player1 oder player2 gesetzt werden muss
        const { data: nextMatch, error: nextFetchError } = await supabaseClient
            .from('matches').select('player1_id, player2_id').eq('id', nextMatchId).single();

        if (nextFetchError || !nextMatch) { console.error(`Next match ${nextMatchId} not found!`); }
        else {
            let payload = {};
            if (!nextMatch.player1_id) payload.player1_id = winnerId;
            else if (!nextMatch.player2_id) payload.player2_id = winnerId;

            if (Object.keys(payload).length > 0) {
                console.log(`Updating next match ${nextMatchId} for winner ${winnerId}`);
                updates.push(supabaseClient.from('matches').update(payload).eq('id', nextMatchId));
                 // Wenn das nächste Match jetzt voll ist, planen? -> Eigene Funktion scheduleIfReady(nextMatchId)
            }
        }
    } else { /* Finalspiel gewonnen -> Rang setzen */ }

    // 4. Verlierer behandeln
    if (completedMatchData.loser_to_match_id) {
        const loserMatchId = completedMatchData.loser_to_match_id;
         // Spezialfall QF-Verlierer
         if (completedMatchData.round_type === 'koqf') {
             // storeQuarterFinalLoserInDB(loserId, loserScore); // Funktion, die in DB speichert oder markiert
         } else {
             // Finde heraus, ob player1 oder player2 gesetzt werden muss
             const { data: loserMatch, error: loserFetchError } = await supabaseClient
                 .from('matches').select('player1_id, player2_id').eq('id', loserMatchId).single();

             if (loserFetchError || !loserMatch) { console.error(`Loser match ${loserMatchId} not found!`); }
             else {
                 let payload = {};
                 if (!loserMatch.player1_id) payload.player1_id = loserId;
                 else if (!loserMatch.player2_id) payload.player2_id = loserId;

                 if (Object.keys(payload).length > 0) {
                     console.log(`Updating loser match ${loserMatchId} for loser ${loserId}`);
                     updates.push(supabaseClient.from('matches').update(payload).eq('id', loserMatchId));
                      // Wenn das Verlierer-Match jetzt voll ist, planen? -> scheduleIfReady(loserMatchId)
                 }
             }
         }
    } else { /* Ausgeschieden oder Rang setzen */ }

    // Führe alle Updates aus
    const results = await Promise.all(updates);
    const updateErrors = results.filter(res => res.error);
    if (updateErrors.length > 0) {
        console.error("Error updating subsequent matches:", updateErrors);
    } else {
        console.log("Successfully updated subsequent matches.");
         // Daten neu laden, um Änderungen in der UI zu sehen
         // await loadInitialTournamentData(); // Könnte durch Realtime ersetzt werden
    }

    // Ggf. 5-8 Seeding anstossen, falls QF abgeschlossen
     if (completedMatchData.round_type === 'koqf') {
        // Prüfe ob alle QF fertig sind (via DB Abfrage)
        // await seed5th8thBracketFromDB(); // Funktion anpassen
     }
}


// --- Admin Button Handler (Phase 2) ---
async function handleGenerateTournament() {
    // Bestätigungsdialog
    if (!confirm("Sicher, dass alle bestehenden Matches gelöscht und neue Gruppenspiele generiert werden sollen? Dies kann nicht rückgängig gemacht werden!")) return;

    // 1. (Optional aber empfohlen) Alle alten Matches löschen
    console.log("Deleting existing matches...");
    const { error: deleteError } = await supabaseClient.from('matches').delete().neq('id', '0'); // Lösche alle
    if (deleteError) {
        alert(`Fehler beim Löschen alter Matches: ${deleteError.message}`);
        return;
    }
    console.log("Old matches deleted.");
    currentTournamentData = { matches: [], participants: currentTournamentData.participants, groups: {}, knockoutMatches: {} }; // Lokalen Cache leeren


    // 2. Gruppen und Matches generieren und in DB schreiben
    alert("Generiere Gruppenspiele... Dies kann einen Moment dauern.");
    const success = await generateGroupsAndMatches(); // Diese Funktion schreibt in die DB

    if (success) {
        alert("Gruppenspiele erfolgreich generiert und gespeichert!");
    } else {
        alert("Fehler beim Generieren der Gruppenspiele.");
    }
}

async function handleSeedKo() {
     // 1. Prüfen, ob alle Gruppenspiele 'confirmed' sind (DB Abfrage)
     const { data: groupMatches, error: fetchGroupError } = await supabaseClient
         .from('matches')
         .select('status')
         .eq('round_type', 'group');

     if (fetchGroupError) { alert(`Fehler beim Prüfen der Gruppenspiele: ${fetchGroupError.message}`); return; }

     const allConfirmed = groupMatches.every(m => m.status === 'confirmed');
     if (!allConfirmed) { alert("Die Gruppenphase ist noch nicht abgeschlossen!"); return; }

     // 2. Bestätigungsdialog
     if (!confirm("Sicher, dass die KO-Runde jetzt basierend auf den Gruppenergebnissen gesetzt werden soll?")) return;

     // 3. KO-Bracket Seeding (Funktion muss DB schreiben)
     alert("Setze KO-Runde... Dies kann einen Moment dauern.");
     const success = await seedKnockoutBracketFromDB(); // Diese Funktion schreibt in die DB

     if (success) {
         alert("KO-Runde erfolgreich gesetzt!");
     } else {
         alert("Fehler beim Setzen der KO-Runde.");
     }
}


// --- Event Listener Setup ---
function addEventListeners() {
    // Auth Buttons
    showRegisterBtn?.addEventListener('click', () => showAuthForm(registerForm));
    showLoginBtn?.addEventListener('click', () => showAuthForm(loginForm));
    // Logout Button hinzufügen im HTML und hier Listener hinzufügen:
    // document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

    // Forms
    registerForm?.addEventListener('submit', handleRegister);
    loginForm?.addEventListener('submit', handleLogin);
    // Kein Verify Button mehr

    // Navigation
    participateBtn?.addEventListener('click', () => displayTournamentPlan());
    document.querySelector('#main-screen header h1')?.addEventListener('click', () => displayTournamentOverview());

    // Filter
    nameFilterInput?.addEventListener('input', () => {
        // Kein Speichern in localStorage mehr nötig
        displayTournamentPlan(); // Filterung geschieht clientseitig beim Rendern
    });

    // Modals
    closeResultModalBtn?.addEventListener('click', () => resultModal.classList.add('hidden'));
    closeConfirmModalBtn?.addEventListener('click', () => confirmModal.classList.add('hidden'));
    resultForm?.addEventListener('submit', handleResultSubmit);
    confirmAcceptBtn?.addEventListener('click', handleConfirmAccept);
    confirmRejectBtn?.addEventListener('click', handleConfirmReject);

    // Admin Buttons
    document.getElementById('generate-tournament-btn')?.addEventListener('click', handleGenerateTournament);
    document.getElementById('seed-ko-btn')?.addEventListener('click', handleSeedKo);

    // Dynamische Listener für Ergebnis-Buttons (wird in display... aufgerufen)
}

function addResultButtonListeners() {
    document.querySelectorAll('.result-btn').forEach(button => {
        // Ersetze Button, um alte Listener sicher zu entfernen
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
        // Füge Listener zum neuen Button hinzu, wenn nicht disabled
        if (!newButton.disabled) {
            newButton.addEventListener('click', handleResultButtonClick);
        }
    });
}


// --- Initialer Start ---
document.addEventListener('DOMContentLoaded', () => {
    addEventListeners(); // Füge Listener hinzu
    // onAuthStateChange kümmert sich um das Laden der Daten und die initiale UI
});
