window.Game = (() => {

  const VERSION = 'v2026.04.10 · 9496f40';

  const SUPABASE_URL = 'https://khrmochnfldrwynuwzrb.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtocm1vY2huZmxkcnd5bnV3enJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NzIzNjEsImV4cCI6MjA5MTI0ODM2MX0.RmtX0P5KysCPgdHIke2CQqeJCv1OiI7uBjVgvtpPxuI';

  let supabase = null;
  let roomChannel = null;
  let guestJoinTimeout = null;

  // ===== AUDIO =====
  const SFX = (() => {
    let ctx = null, muted = false;
    function ensure() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function warmUp() {
      ensure();
      const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); o.stop(ctx.currentTime+0.001);
      document.removeEventListener('mousedown',warmUp); document.removeEventListener('touchstart',warmUp); document.removeEventListener('keydown',warmUp);
    }
    document.addEventListener('mousedown',warmUp); document.addEventListener('touchstart',warmUp,{passive:true}); document.addEventListener('keydown',warmUp);

    function play(t) {
      if (muted) return;
      const c = ensure();
      try {
        const now = c.currentTime + 0.015;
        const osc = (type, freq, dur, vol=0.06) => {
          const o = c.createOscillator(), g = c.createGain();
          o.type = type; o.frequency.setValueAtTime(freq, now);
          g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.001, now+dur);
          o.connect(g).connect(c.destination); o.start(now); o.stop(now+dur);
          return o;
        };
        switch(t) {
          case 'tick': osc('sine',880,0.08,0.08); break;
          case 'type': osc('sine',600+Math.random()*200,0.05,0.04); break;
          case 'delete': osc('sine',300,0.06,0.04); break;
          case 'submit': { const o=osc('triangle',440,0.2,0.1); o.frequency.linearRampToValueAtTime(660,now+0.1); break; }
          case 'high': { const o=osc('sawtooth',520,0.3,0.06); o.frequency.linearRampToValueAtTime(320,now+0.25); break; }
          case 'low': { const o=osc('sawtooth',220,0.3,0.06); o.frequency.linearRampToValueAtTime(420,now+0.25); break; }
          case 'win': [0,.12,.24,.36,.48].forEach((d,i)=>{const f=[523.25,659.25,783.99,1046.5,1318.5]; const o=c.createOscillator(),g=c.createGain(); o.type='sine'; o.frequency.setValueAtTime(f[i],now+d); g.gain.setValueAtTime(0.12,now+d); g.gain.exponentialRampToValueAtTime(0.001,now+d+0.3); o.connect(g).connect(c.destination); o.start(now+d); o.stop(now+d+0.35);}); break;
          case 'whoosh': { const bs=c.sampleRate*0.15,b=c.createBuffer(1,bs,c.sampleRate),d=b.getChannelData(0); for(let i=0;i<bs;i++) d[i]=(Math.random()*2-1)*(1-i/bs); const s=c.createBufferSource(); s.buffer=b; const g=c.createGain(),f=c.createBiquadFilter(); f.type='bandpass'; f.frequency.setValueAtTime(2000,now); f.frequency.linearRampToValueAtTime(500,now+0.15); f.Q.value=2; g.gain.setValueAtTime(0.08,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.15); s.connect(f).connect(g).connect(c.destination); s.start(now); s.stop(now+0.15); break; }
          case 'click': osc('sine',1200,0.04,0.06); break;
          case 'turn': osc('triangle',800,0.12,0.1); break;
        }
      } catch(e){}
    }
    return { play, toggle(){ muted=!muted; return muted; }, isMuted(){ return muted; } };
  })();

  // ===== STATE =====
  const S = {
    gameType: 'classic', 
    mode: 'solo', 
    target: 0, 
    targetStr: '', 
    knownDigits: [null, null, null, null], 
    attempt: 0, 
    startTime: 0, 
    elapsed: 0,
    timerInterval: null, 
    playerName: '', 
    won: false, 
    typedValue: '', 
    gameOver: false,
    rangeLow: 0, 
    rangeHigh: 100,
    
    // Multi (Supabase)
    roomCode: null, oppName: '', rounds: 3, currentRound: 0,
    mySecret: 0, oppSecret: 0, iAmReady: false, oppReady: false,
    myFinalData: null, oppFinalData: null, choosingInterval: null,
    roundResults: [], oppRoundResults: [],
    _pendingOppReadyRound: 0,
    
    // Turn-based & Rematch
    myTurn: false, iFinished: false, oppFinished: false,
    iWantRematch: false, oppWantsRematch: false,
    newlyLocked: null,
    
    // Opp range
    oppRangeLow: 0, oppRangeHigh: 100
  };

  const $ = id => document.getElementById(id);

  // ===== MODAL =====
  function showModal(message, buttons) {
    $('modal-message').textContent = message;
    const actions = $('modal-actions');
    actions.innerHTML = '';
    buttons.forEach(({ label, className, onClick }) => {
      const btn = document.createElement('button');
      btn.className = 'modal-btn ' + (className || 'primary');
      btn.textContent = label;
      btn.onclick = () => {
        $('modal-overlay').classList.add('hidden');
        if (onClick) onClick();
      };
      actions.appendChild(btn);
    });
    $('modal-overlay').classList.remove('hidden');
  }

  function showAlert(message, onClose) {
    showModal(message, [{ label: 'OK', className: 'primary', onClick: onClose }]);
  }

  function showConfirm(message, onConfirm, onCancel) {
    showModal(message, [
      { label: 'Cancel', className: 'secondary', onClick: onCancel },
      { label: 'Confirm', className: 'danger',   onClick: onConfirm },
    ]);
  }

  function show(id) {
    SFX.play('whoosh');
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
    if (id === 'game-screen') $('hidden-input').focus();
  }

  function rand(a,b) { return Math.floor(Math.random()*(b-a+1))+a; }
  function fmtTime(ms) { const s=Math.floor(ms/1000); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }

  function getTemperature(diff) {
    if (diff <= 3)  return { label:'Burning!',  cls:'burning',  emoji:'🔥', hint:'So close!' };
    if (diff <= 8)  return { label:'Hot',        cls:'hot',      emoji:'♨️',  hint:'Getting warmer...' };
    if (diff <= 15) return { label:'Warm',       cls:'warm',     emoji:'🌡️', hint:'Somewhat close' };
    if (diff <= 25) return { label:'Lukewarm',   cls:'lukewarm', emoji:'😐', hint:'Barely anything' };
    if (diff <= 40) return { label:'Cold',       cls:'cold',     emoji:'🧊', hint:'Far away' };
    return           { label:'Freezing!',  cls:'freezing', emoji:'❄️', hint:'Very far away' };
  }

  function burst(x,y,n,colors,cid='particles') {
    const c=$(cid);
    for(let i=0;i<n;i++){
      const p=document.createElement('div'); p.className='particle';
      const a=(Math.PI*2/n)*i+Math.random()*0.5, d=60+Math.random()*120;
      p.style.left=x+'px'; p.style.top=y+'px';
      p.style.setProperty('--px',Math.cos(a)*d+'px'); p.style.setProperty('--py',Math.sin(a)*d+'px');
      p.style.background=colors[Math.floor(Math.random()*colors.length)];
      const sz=4+Math.random()*5; p.style.width=sz+'px'; p.style.height=sz+'px';
      c.appendChild(p); setTimeout(()=>p.remove(),1000);
    }
  }

  // ===== THEME TOGGLE =====
  function initTheme() {
      if (localStorage.getItem('gtn-theme') === 'light') {
          document.body.classList.add('light-mode');
      }
  }

  function toggleTheme() {
      const isLight = document.body.classList.toggle('light-mode');
      localStorage.setItem('gtn-theme', isLight ? 'light' : 'dark');
      SFX.play('click');
  }

  // ===== MODE TOGGLE =====
  function setGameType(type) {
    S.gameType = type;
    $('tab-classic').classList.toggle('active', type === 'classic');
    $('tab-digits').classList.toggle('active', type === 'digits');
    $('tab-hotcold').classList.toggle('active', type === 'hotcold');
    const logoText = { classic: 'Number', digits: 'PIN', hotcold: 'Temperature' }[type] || 'Number';
    $('logo-mode-text').textContent = logoText;
    const desc = {
      classic:  'Find the hidden number from 0 to 100.<br>Fewer attempts = higher score.',
      digits:   'Guess the 4-digit PIN.<br>Green digits stay in place.',
      hotcold:  'Guess the number from 0 to 100.<br>Only temperature hints tell you how close you are.'
    };
    $('intro-desc-text').innerHTML = desc[type] || desc.classic;
    SFX.play('click');
  }

  function setMultiMode(mode) {
    $('tab-create').classList.toggle('active', mode === 'create');
    $('tab-join').classList.toggle('active', mode === 'join');
    
    if (mode === 'create') {
        $('multi-create-section').classList.remove('hidden');
        $('multi-join-section').classList.add('hidden');
    } else {
        $('multi-create-section').classList.add('hidden');
        $('multi-join-section').classList.remove('hidden');
    }
    SFX.play('click');
  }

  // ===== RANGE UI (CLASSIC) =====
  function resetRange() {
    S.rangeLow = 0; S.rangeHigh = 100;
    $('range-low').textContent = '0'; $('range-low').className = 'range-num';
    $('range-high').textContent = '100'; $('range-high').className = 'range-num';
    $('range-low-arrow').className = 'range-arrow';
    $('range-high-arrow').className = 'range-arrow';
  }

  function updateRange(val, isHigh) {
    if (isHigh && val < S.rangeHigh) {
      S.rangeHigh = val;
      $('range-high').textContent = val;
      $('range-high').className = 'range-num high updated';
      $('range-high-arrow').className = 'range-arrow high';
      setTimeout(()=> $('range-high').classList.remove('updated'), 400);
    } else if (!isHigh && val > S.rangeLow) {
      S.rangeLow = val;
      $('range-low').textContent = val;
      $('range-low').className = 'range-num low updated';
      $('range-low-arrow').className = 'range-arrow low';
      setTimeout(()=> $('range-low').classList.remove('updated'), 400);
    }
  }

  function resetOppRange() {
    S.oppRangeLow = 0; S.oppRangeHigh = 100;
    const hideBounds = S.gameType === 'digits' || S.gameType === 'hotcold';
    $('opp-range-low').textContent = hideBounds ? '' : '0';
    $('opp-range-high').textContent = hideBounds ? '' : '100';
    $('opp-arrow-l').textContent = hideBounds ? '' : 'low';
    $('opp-arrow-h').textContent = hideBounds ? '' : 'high';
    $('opp-range-current').textContent = '—';
    $('opp-range-current').className = 'opp-range-current';
    $('opp-range-hint').textContent = '';
    $('opp-range-hint').className = 'opp-range-hint';
  }

  function updateOppRange(val, isHigh, correct) {
    $('opp-range-current').textContent = val;
    if (correct) {
      $('opp-range-current').className = 'opp-range-current correct';
      $('opp-range-hint').textContent = 'Found it!';
      $('opp-range-hint').className = 'opp-range-hint correct';
    } else if (S.gameType === 'classic') {
      if (isHigh) {
        $('opp-range-current').className = 'opp-range-current high';
        $('opp-range-hint').textContent = '↓ Too high';
        $('opp-range-hint').className = 'opp-range-hint high';
        if (val < S.oppRangeHigh) { S.oppRangeHigh = val; $('opp-range-high').textContent = val; $('opp-range-high').className = 'opp-range-num high'; }
      } else {
        $('opp-range-current').className = 'opp-range-current low';
        $('opp-range-hint').textContent = '↑ Too low';
        $('opp-range-hint').className = 'opp-range-hint low';
        if (val > S.oppRangeLow) { S.oppRangeLow = val; $('opp-range-low').textContent = val; $('opp-range-low').className = 'opp-range-num low'; }
      }
    } else {
        $('opp-range-current').className = 'opp-range-current';
        $('opp-range-hint').textContent = 'Guessing...';
        $('opp-range-hint').className = 'opp-range-hint';
    }
  }

  // ===== TURN UI =====
  function updateTurnUI() {
    if (S.mode === 'solo') return;
    const gc = $('game-container'), oc = $('opp-container');

    // Hot & Cold multi: both players always active, no turn glow
    if (S.gameType === 'hotcold') {
      gc.classList.remove('my-turn-active', 'turn-pulse');
      oc.classList.remove('opp-turn-active', 'opp-turn-pulse');
      if (S.iFinished) {
        $('main-display').style.opacity = '0.3';
        $('submit-row').style.opacity = '0.3'; $('submit-row').style.pointerEvents = 'none';
      } else {
        $('main-display').style.opacity = '1';
        $('submit-row').style.opacity = '1'; $('submit-row').style.pointerEvents = 'auto';
      }
      return;
    }

    if (S.iFinished) {
      $('main-display').style.opacity = '0.3';
      $('submit-row').style.opacity = '0.3'; $('submit-row').style.pointerEvents = 'none';
      gc.classList.remove('my-turn-active', 'turn-pulse');
      if (!S.oppFinished) {
        oc.classList.add('opp-turn-active');
      } else {
        oc.classList.remove('opp-turn-active', 'opp-turn-pulse');
      }
      return;
    }

    if (S.myTurn) {
      $('main-display').style.opacity = '1';
      $('submit-row').style.opacity = '1'; $('submit-row').style.pointerEvents = 'auto';
      gc.classList.remove('turn-pulse'); void gc.offsetWidth; gc.classList.add('turn-pulse');
      gc.classList.add('my-turn-active');
      oc.classList.remove('opp-turn-active', 'opp-turn-pulse');
    } else {
      $('main-display').style.opacity = '0.4';
      $('submit-row').style.opacity = '0.3'; $('submit-row').style.pointerEvents = 'none';
      S.typedValue = ''; updateBigNum();
      gc.classList.remove('my-turn-active', 'turn-pulse');
      oc.classList.remove('opp-turn-pulse'); void oc.offsetWidth; oc.classList.add('opp-turn-pulse');
      oc.classList.add('opp-turn-active');
    }
  }

  // ===== SUPABASE NETWORKING =====
  function initSupabase() {
      if (!window.supabase) {
          showAlert("Error: Supabase library not loaded.");
          return false;
      }
      if (!supabase) {
          supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      }
      return true;
  }

  function sendData(payload) {
      if (roomChannel) {
          roomChannel.send({
              type: 'broadcast',
              event: 'game-action',
              payload: payload
          });
      }
  }

  function handleNetworkData(d) {
      if (d.type === 'GUEST_JOINED' && S.mode === 'host') {
          // Zatrzymujemy timeout na czekanie gościa jeśli byśmy go mieli
          sendData({ type:'INIT', name:S.playerName, rounds:S.rounds, gameType:S.gameType });
      }
      else if (d.type==='INIT') { 
          clearTimeout(guestJoinTimeout);
          S.oppName=d.name; 
          S.rounds=d.rounds; 
          S.gameType=d.gameType; 
          sendData({type:'INIT_ACK',name:S.playerName}); 
          startChoosing(); 
      }
      else if (d.type==='INIT_ACK') { S.oppName=d.name; startChoosing(); }
      else if (d.type==='READY') {
          // In hotcold, READY can arrive before our own startChoosing resets oppReady —
          // buffer it if it's for a future round to avoid losing the signal.
          if (S.gameType === 'hotcold' && d.round !== undefined && d.round > S.currentRound) {
              S._pendingOppReadyRound = d.round;
          } else {
              if(S.gameType==='digits') S.oppSecretStr=d.secretStr; else S.oppSecret=d.secret;
              S.oppReady=true; checkStartRound();
          }
      }
      else if (d.type==='START') {
          clearInterval(S.choosingInterval);
          if (S.gameType === 'digits')   S.targetStr = d.guestTarget;
          else if (S.gameType === 'hotcold') S.target = d.sharedTarget; // same number for both
          else                           S.target = d.guestTarget;
          _launchRound();
      }
      else if (d.type==='GUESS') { handleOppGuess(d); }
      else if (d.type==='FINISH') { S.oppFinalData=d.payload; S.oppFinished=true; updateTurnUI(); checkShowResult(); }
      else if (d.type==='REMATCH') {
          S.oppWantsRematch = true;
          if (S.iWantRematch) restartMatch();
      }
      else if (d.type==='QUIT') {
          showAlert('Opponent left the room.', () => window.location.reload());
      }
  }

  // ===== INIT =====
  function init() {
    $('app-version').textContent = VERSION;
    initTheme();
    document.addEventListener('keydown', onKey);
    $('game-screen').addEventListener('click', ()=>{ if(!S.gameOver && (S.mode==='solo'||S.myTurn||S.gameType==='hotcold')) $('hidden-input').focus(); });
    $('player-name').addEventListener('input', updateSetupButtons);
    $('guest-code').addEventListener('input', updateSetupButtons);
    
    $('guest-code').addEventListener('keydown', e=>{ 
        if(e.key==='Enter' && !$('guest-play-btn').disabled) guestPlay(); 
    });
    $('player-name').addEventListener('keydown', e=>{ 
        if(e.key==='Enter') {
            if (!$('guest-play-btn').disabled && !$('multi-join-section').classList.contains('hidden')) guestPlay();
            else if (!$('setup-play-btn').disabled && !$('multi-create-section').classList.contains('hidden')) hostPlay();
        }
    });
  }

  // ===== SETUP =====
  function updateSetupButtons() {
      const hasName = $('player-name').value.trim().length > 0;
      const codeLen = $('guest-code').value.trim().length;
      $('setup-play-btn').disabled = !hasName;
      $('guest-play-btn').disabled = !(hasName && codeLen === 6);
  }

  function resetGuestError() {
    $('join-error').classList.add('hidden');
    $('guest-code').value = '';
    updateSetupButtons();
  }

  function setRounds(n) {
    S.rounds = n;
    document.querySelectorAll('.round-pill').forEach(b => b.classList.toggle('active', +b.dataset.rounds===n));
    SFX.play('click');
  }

  function hostPlay() {
    S.playerName = $('player-name').value.trim();
    if (!S.playerName) return;
    
    if (!initSupabase()) return;

    SFX.play('click');
    S.mode = 'host';
    $('player-name').disabled = true;
    $('create-join-section').classList.add('hidden');
    $('waiting-section').classList.remove('hidden');

    S.roomCode = Math.floor(100000 + Math.random() * 900000).toString();
    $('room-code-display').textContent = S.roomCode;

    // Create Realtime Channel
    roomChannel = supabase.channel(`room-${S.roomCode}`, {
        config: { presence: { key: S.playerName } }
    });

    roomChannel
        .on('broadcast', { event: 'game-action' }, ({ payload }) => handleNetworkData(payload))
        .on('presence', { event: 'leave' }, () => {
             if (S.oppName && !S.gameOver) {
                 showAlert('Opponent disconnected.', () => window.location.reload());
             }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await roomChannel.track({ user: 'host' });
            }
        });
  }

  function guestPlay() {
    S.playerName = $('player-name').value.trim();
    const code = $('guest-code').value.trim();
    if (!S.playerName || code.length !== 6) return;
    
    if (!initSupabase()) return;

    SFX.play('click');
    S.mode = 'guest';
    
    $('guest-play-btn').innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="spin-anim"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="4.93" x2="19.07" y2="7.76"/></svg>';
    $('guest-play-btn').disabled = true;
    $('setup-play-btn').disabled = true;
    $('player-name').disabled = true;
    $('guest-code').disabled = true;

    S.roomCode = code;

    roomChannel = supabase.channel(`room-${S.roomCode}`, {
        config: { presence: { key: S.playerName } }
    });

    roomChannel
        .on('broadcast', { event: 'game-action' }, ({ payload }) => handleNetworkData(payload))
        .on('presence', { event: 'leave' }, () => {
             if (S.oppName && !S.gameOver) {
                 showAlert('Opponent disconnected.', () => window.location.reload());
             }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await roomChannel.track({ user: 'guest' });
                // Notify Host we are here
                sendData({ type: 'GUEST_JOINED' });
                
                // Timeout if host doesn't reply
                guestJoinTimeout = setTimeout(() => {
                    $('join-error').classList.remove('hidden');
                    const arrowSVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
                    $('guest-play-btn').innerHTML = arrowSVG;
                    $('guest-play-btn').disabled = false;
                    $('player-name').disabled = false;
                    $('guest-code').disabled = false;
                    updateSetupButtons();
                    if (roomChannel) { roomChannel.unsubscribe(); roomChannel = null; }
                }, 5000);
            }
        });
  }

  // ===== CHOOSING PHASE =====
  function startChoosing() {
    S.currentRound++;
    S.iAmReady = false; S.oppReady = false;
    S.myFinalData = null; S.oppFinalData = null;
    S.iFinished = false; S.oppFinished = false;

    document.body.classList.remove('multi-active');

    // Hot & Cold multi: system picks a shared random target — skip choose screen entirely
    if (S.gameType === 'hotcold') {
      S.iAmReady = true;
      // Restore early READY if it arrived before our startChoosing reset the flag
      if (S._pendingOppReadyRound === S.currentRound) {
        S.oppReady = true;
        S._pendingOppReadyRound = 0;
      }
      sendData({ type: 'READY', secret: 0, round: S.currentRound }); // dummy value, target decided by host
      checkStartRound();
      return;
    }

    show('choose-screen');
    $('choose-status').innerHTML = `Round ${S.currentRound}/${S.rounds} vs <b>${S.oppName}</b>`;
    
    if (S.gameType === 'digits') {
        $('secret-input').placeholder = "0000 - 9999";
    } else {
        $('secret-input').placeholder = "0 - 100";
    }
    
    $('secret-input').value = ''; $('secret-input').disabled = false;
    $('lock-btn').disabled = false; $('lock-btn').textContent = 'Lock In';

    const deadline = Date.now() + 30000;
    clearInterval(S.choosingInterval);
    S.choosingInterval = setInterval(()=>{
      const remaining = Math.max(0, deadline - Date.now());
      const sec = Math.floor(remaining / 1000);
      const ms = remaining % 1000;
      $('choose-sec').textContent = sec;
      $('choose-ms').textContent = '.' + String(Math.floor(ms / 10)).padStart(2, '0');
      if (remaining <= 0) { clearInterval(S.choosingInterval); if(!S.iAmReady) lockSecret(true); }
    }, 37);
  }

  function lockSecret(forced = false) {
    if (S.iAmReady) return;
    SFX.play('click');
    if (forced) {
      const st = $('choose-status');
      st.textContent = "⏰ Time's up! Random value locked.";
      st.style.color = '#ffd43b';
    }
    
    if (S.gameType === 'digits') {
        let v = $('secret-input').value.trim();
        if(v.length === 0) v = String(rand(0, 9999)).padStart(4, '0');
        v = v.substring(0,4).padStart(4, '0');
        $('secret-input').value = v;
        S.mySecretStr = v;
        sendData({ type:'READY', secretStr:S.mySecretStr });
    } else {
        let v = parseInt($('secret-input').value, 10);
        if (isNaN(v)||v<0||v>100) { v=rand(0,100); $('secret-input').value=v; }
        S.mySecret = v;
        sendData({ type:'READY', secret:S.mySecret });
    }

    S.iAmReady = true;
    $('secret-input').disabled = true;
    $('lock-btn').disabled = true;
    $('lock-btn').textContent = 'Waiting...';
    checkStartRound();
  }

  function checkStartRound() {
    if (!S.iAmReady || !S.oppReady) return;
    clearInterval(S.choosingInterval);

    // Only the HOST drives the round start — tells the guest what to guess
    if (S.mode === 'host') {
      if (S.gameType === 'digits') {
        S.targetStr = S.oppSecretStr;
        sendData({ type: 'START', guestTarget: S.mySecretStr });
      } else if (S.gameType === 'hotcold') {
        // System picks one shared target for both players
        const sharedTarget = rand(0, 100);
        S.target = sharedTarget;
        sendData({ type: 'START', sharedTarget });
      } else {
        S.target = S.oppSecret;
        sendData({ type: 'START', guestTarget: S.mySecret });
      }
      _launchRound();
    }
    // Guest waits for the START message — see handleNetworkData
  }

  function _launchRound() {
    resetGameUI();
    resetRange();
    resetOppRange();

    // Hot & Cold multi: both players always active simultaneously
    S.myTurn = (S.mode === 'host') || (S.gameType === 'hotcold');
    S.iFinished = false;
    S.oppFinished = false;

    document.body.classList.add('multi-active');
    document.body.classList.toggle('hotcold-active', S.gameType === 'hotcold');
    $('opp-card-name').textContent = S.oppName;
    $('opp-card-att').textContent = '0';
    $('opp-card-chips').innerHTML = '';

    // Set history panel header label per mode
    const labels = { classic: 'My guesses', digits: 'My attempts', hotcold: 'My guesses' };
    $('hc-header-label').textContent = labels[S.gameType] || 'My guesses';

    const rb = $('round-badge');
    if (S.rounds > 1) { rb.classList.remove('hidden'); rb.textContent = `Round ${S.currentRound}/${S.rounds}`; }
    else rb.classList.add('hidden');

    show('game-screen');

    if (S.gameType === 'hotcold') {
      // 5-second countdown so both players start at the same time
      updateTurnUI();
      startCountdown(() => startTimer());
    } else {
      updateTurnUI();
      startTimer();
    }
  }

  function startCountdown(onDone) {
    const overlay = $('countdown-overlay');
    const numEl   = $('countdown-num');
    let count = 5;
    numEl.textContent = count;
    overlay.classList.remove('hidden');
    // Trigger CSS pulse animation on first number
    numEl.classList.remove('count-enter'); void numEl.offsetWidth; numEl.classList.add('count-enter');
    SFX.play('tick');

    const iv = setInterval(() => {
      count--;
      if (count > 0) {
        numEl.textContent = count;
        numEl.classList.remove('count-enter'); void numEl.offsetWidth; numEl.classList.add('count-enter');
        SFX.play('tick');
      } else {
        clearInterval(iv);
        overlay.classList.add('hidden');
        SFX.play('submit');
        onDone();
      }
    }, 1000);
  }

  function handleOppGuess(d) {
    $('opp-card-att').textContent = d.attempt;

    if (S.gameType === 'hotcold') {
        // Don't reveal opponent's guesses or temperatures — only show when they win
        if (d.correct) {
            $('opp-range-current').textContent = '✓';
            $('opp-range-current').className = 'opp-range-current correct';
            $('opp-range-hint').textContent = 'Found it!';
            $('opp-range-hint').className = 'opp-range-hint correct';
        }
    } else {
        const chip = document.createElement('div');
        if (S.gameType === 'digits') {
            updateOppRange(d.numberStr, false, d.correct);
            chip.className = 'opp-chip digits ' + (d.correct ? 'correct' : '');
            chip.textContent = d.numberStr;
        } else {
            updateOppRange(d.number, d.isHigh, d.correct);
            const cls = d.correct ? 'correct' : (d.isHigh ? 'high' : 'low');
            chip.className = 'opp-chip ' + cls;
            chip.textContent = d.number;
        }
        $('opp-card-chips').appendChild(chip);
        $('opp-card-chips').scrollTop = $('opp-card-chips').scrollHeight;
    }

    if (d.correct) {
      S.oppFinished = true;
      // Hot & Cold: no turn switch — both always play simultaneously
      if (!S.iFinished && S.gameType !== 'hotcold') { S.myTurn = true; updateTurnUI(); SFX.play('turn'); }
    } else {
      if (!S.iFinished && S.gameType !== 'hotcold') { S.myTurn = true; updateTurnUI(); SFX.play('turn'); }
    }
  }

  // ===== KEYBOARD & UI UPDATES =====
  function onKey(e) {
    const scr = document.querySelector('.screen.active');
    if (scr && scr.id === 'choose-screen' && e.key === 'Enter') { lockSecret(); return; }
    if (!scr || scr.id !== 'game-screen' || S.gameOver) return;
    if (S.mode !== 'solo' && !S.myTurn && S.gameType !== 'hotcold') return;
    if (S.mode !== 'solo' && S.iFinished) return;

    if (e.key >= '0' && e.key <= '9') { 
        e.preventDefault(); 
        const limit = S.gameType === 'digits' ? S.knownDigits.filter(d=>d===null).length : 3;
        if(S.typedValue.length < limit){ S.typedValue+=e.key; SFX.play('type'); updateBigNum(); } 
    }
    else if (e.key==='Backspace') { e.preventDefault(); if(S.typedValue.length>0){ S.typedValue=S.typedValue.slice(0,-1); SFX.play('delete'); updateBigNum(); } }
    else if (e.key==='Enter') { e.preventDefault(); guess(); }
    else if (e.key==='Escape') { e.preventDefault(); clearInput(); }
  }

  function updateBigNum() {
    const el=$('big-number'), txt=$('big-number-text'), hint=$('big-number-hint');
    
    if (S.gameType === 'digits') {
        let html = '';
        let typeIdx = 0;
        let allEmpty = true;
        
        for (let i = 0; i < 4; i++) {
            if (S.knownDigits[i] !== null) {
                const isNew = S.newlyLocked && S.newlyLocked[i];
                html += `<span class="${isNew ? 'digit-locked-new' : ''}" style="color:#51cf66">${S.knownDigits[i]}</span>`;
                allEmpty = false;
            } else {
                if (S.typedValue[typeIdx]) {
                    html += `<span>${S.typedValue[typeIdx]}</span>`;
                    typeIdx++;
                    allEmpty = false;
                } else {
                    html += `<span style="opacity:0.2">_</span>`;
                }
            }
        }
        
        txt.innerHTML = html;
        
        if (allEmpty && !S.typedValue) {
            el.classList.add('placeholder');
        } else {
            el.classList.remove('placeholder');
        }
        
        const needed = S.knownDigits.filter(d=>d===null).length;
        hint.textContent = S.typedValue.length === needed ? 'press enter' : 'type code';
        hint.style.opacity = S.typedValue.length === needed ? '0.4' : '1';
        
    } else {
        if (!S.typedValue) {
          txt.textContent='?'; el.classList.add('placeholder');
          if(S.mode==='solo'||S.myTurn||S.gameType==='hotcold') { hint.textContent='type a number'; hint.style.opacity='1'; }
        } else {
          txt.textContent=S.typedValue; el.classList.remove('placeholder');
          hint.textContent='press enter'; hint.style.opacity='0.4';
          el.classList.remove('num-slide-in'); void el.offsetWidth; el.classList.add('num-slide-in');
        }
    }
  }

  function clearInput() {
    if (S.mode !== 'solo' && !S.myTurn && S.gameType !== 'hotcold') return;
    S.typedValue=''; SFX.play('delete'); updateBigNum();
  }

  // ===== GAME PLAY =====
  function resetGameUI() {
    S.attempt=0; S.won=false; S.gameOver=false; S.elapsed=0; S.typedValue=''; S.myFinalData=null;
    S.knownDigits = [null, null, null, null]; S.newlyLocked = null;
    $('att-num').textContent='0'; $('game-timer').textContent='00:00';
    $('hidden-input').value='';
    $('big-number').style.color = '';
    $('cursor-blink').style.display = '';
    
    if (S.gameType === 'digits') {
        $('bound-low-container').style.visibility = 'hidden';
        $('bound-high-container').style.visibility = 'hidden';
        $('history-container').classList.add('hidden');
        $('history-container').innerHTML = '';
    } else if (S.gameType === 'hotcold') {
        $('bound-low-container').style.visibility = 'hidden';
        $('bound-high-container').style.visibility = 'hidden';
        $('history-container').classList.add('hidden');
    } else {
        $('bound-low-container').style.visibility = 'visible';
        $('bound-high-container').style.visibility = 'visible';
        $('history-container').classList.add('hidden');
    }
    // Always reset side history panel (used in hotcold solo + all multi modes)
    $('hc-list').innerHTML = '';
    $('hc-att-num').textContent = '0';
    
    $('main-display').style.opacity='1';
    $('submit-row').style.opacity='1'; $('submit-row').style.pointerEvents='auto';
    
    updateBigNum();
    $('feedback-text').textContent=''; $('feedback-text').className='feedback-text';
    $('feedback-sub').textContent=''; $('feedback-sub').classList.remove('visible');
    $('game-container').classList.remove('my-turn-active', 'turn-pulse');
    $('opp-container').classList.remove('opp-turn-active', 'opp-turn-pulse');
    clearInterval(S.timerInterval);
  }

  function startTimer() {
    S.startTime=Date.now();
    S.timerInterval=setInterval(()=>{ S.elapsed=Date.now()-S.startTime; $('game-timer').textContent=fmtTime(S.elapsed); },250);
  }

  function startSolo() {
    SFX.play('click'); S.mode='solo'; S.currentRound=0; S.rounds=1;
    S.roundResults=[]; S.oppRoundResults=[];

    if (S.gameType === 'digits') {
        S.targetStr = String(rand(0, 9999)).padStart(4, '0');
    } else {
        S.target = rand(0,100);
    }

    document.body.classList.remove('multi-active');
    document.body.classList.toggle('hotcold-active', S.gameType === 'hotcold');
    resetGameUI(); resetRange(); show('game-screen'); startTimer();
  }

  function startMulti() {
    SFX.play('click'); S.mode='host';
    S.currentRound=0; S.roundResults=[]; S.oppRoundResults=[];
    
    $('player-name').value=''; $('player-name').disabled=false;
    $('guest-code').value=''; $('guest-code').disabled=false;
    $('create-join-section').classList.remove('hidden');
    $('waiting-section').classList.add('hidden');
    
    $('guest-play-btn').innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    $('setup-play-btn').textContent='Create Room';
    
    updateSetupButtons();
    setMultiMode('create'); 
    setRounds(3);
    show('setup-screen');
    setTimeout(()=>$('player-name').focus(),400);
  }

  function shakeUI() {
      $('game-container').classList.remove('earthquake'); void $('game-container').offsetWidth;
      $('game-container').classList.add('earthquake'); setTimeout(()=>$('game-container').classList.remove('earthquake'),500);
      SFX.play('tick');
  }

  function guess() {
    // Hot & Cold multi: no turns — both players always active
    if (S.mode !== 'solo' && !S.myTurn && S.gameType !== 'hotcold') return;
    if (S.mode !== 'solo' && S.iFinished) return;
    if (S.gameOver && S.mode==='solo') return;

    // DIGITS MODE LOGIC
    if (S.gameType === 'digits') {
        const needed = S.knownDigits.filter(d=>d===null).length;
        if (S.typedValue.length < needed) { shakeUI(); return; }

        SFX.play('submit');
        S.attempt++;
        const an=$('att-num'); an.textContent=S.attempt; an.classList.remove('bump'); void an.offsetWidth; an.classList.add('bump');

        let guessArr = [];
        let typeIdx = 0;
        let newKnown = [...S.knownDigits];
        let isCorrect = true;
        let maskedOppStr = "";

        for (let i = 0; i < 4; i++) {
            if (S.knownDigits[i] !== null) {
                guessArr.push(S.knownDigits[i]);
                maskedOppStr += S.knownDigits[i];
            } else {
                const char = S.typedValue[typeIdx] || '0';
                guessArr.push(char);
                typeIdx++;
                if (char === S.targetStr[i]) {
                    newKnown[i] = char;
                    maskedOppStr += char;
                } else {
                    isCorrect = false;
                    maskedOppStr += "*";
                }
            }
        }

        const prevKnown = [...S.knownDigits];
        S.knownDigits = newKnown;
        S.newlyLocked = newKnown.map((d, i) => d !== null && prevKnown[i] === null);
        S.typedValue = '';

        if (S.mode !== 'solo') {
            sendData({ type:'GUESS', numberStr:maskedOppStr, attempt:S.attempt, correct:isCorrect });
        }

        // Side history panel (multi only)
        if (S.mode !== 'solo') {
            const hItem = document.createElement('div');
            hItem.className = 'hc-item pin-item drop-anim';
            hItem.innerHTML = `<span class="hc-pin-row">${guessArr.map((c, i) =>
                `<span class="${newKnown[i] !== null ? 'correct' : ''}">${c}</span>`
            ).join('')}</span>`;
            $('hc-list').prepend(hItem);
            $('hc-att-num').textContent = S.attempt;
        }

        if (isCorrect) {
            updateBigNum(); S.newlyLocked = null;
            handleWin(guessArr.join(''));
        } else {
            SFX.play('low');
            updateBigNum(); S.newlyLocked = null;

            if (S.mode !== 'solo' && !S.oppFinished) { S.myTurn = false; updateTurnUI(); }
            if (S.mode==='solo' || S.myTurn) $('hidden-input').focus();
        }
        return;
    }

    // HOT & COLD MODE LOGIC
    if (S.gameType === 'hotcold') {
        const val = parseInt(S.typedValue, 10);
        if (isNaN(val)||val<0||val>100) { shakeUI(); return; }

        SFX.play('submit');
        S.attempt++; S.typedValue='';
        const an=$('att-num'); an.textContent=S.attempt; an.classList.remove('bump'); void an.offsetWidth; an.classList.add('bump');

        const diff=Math.abs(val-S.target), fb=$('feedback-text'), sub=$('feedback-sub');
        const temp = getTemperature(diff);
        flashHeat(diff);

        const isCorrect = val===S.target;

        if (S.mode !== 'solo') {
            sendData({ type:'GUESS', number:val, attempt:S.attempt, tempCls:temp.cls, tempLabel:temp.label, correct:isCorrect });
        }

        if (isCorrect) {
            // Add winning entry to side panel
            const winItem = document.createElement('div');
            winItem.className = 'hc-item correct drop-anim';
            winItem.innerHTML = `<span class="hc-item-num">${val}</span><span class="hc-item-badge correct">Found it!</span>`;
            $('hc-list').prepend(winItem);
            $('hc-att-num').textContent = S.attempt;
            handleWin(val);
        } else {
            // Add to side history panel
            const item = document.createElement('div');
            item.className = 'hc-item drop-anim';
            item.innerHTML = `<span class="hc-item-num">${val}</span><span class="hc-item-badge ${temp.cls}">${temp.label}</span>`;
            $('hc-list').prepend(item);
            $('hc-att-num').textContent = S.attempt;

            fb.className = `feedback-text ${temp.cls} visible`;
            fb.textContent = temp.label;
            sub.textContent = temp.hint; sub.classList.add('visible');

            SFX.play(diff <= 15 ? 'high' : 'low');
            const bn=$('big-number'); bn.classList.remove('spring'); void bn.offsetWidth; bn.classList.add('spring'); setTimeout(()=>bn.classList.remove('spring'),500);
            updateBigNum();

            // No turn switching in Hot & Cold — both players always active
            $('hidden-input').focus();
        }
        return;
    }

    // CLASSIC MODE LOGIC
    const val = parseInt(S.typedValue, 10);
    if (isNaN(val)||val<0||val>100) { shakeUI(); return; }

    SFX.play('submit');
    S.attempt++; S.typedValue='';
    const an=$('att-num'); an.textContent=S.attempt; an.classList.remove('bump'); void an.offsetWidth; an.classList.add('bump');

    const diff=Math.abs(val-S.target), fb=$('feedback-text'), sub=$('feedback-sub');
    flashHeat(diff);

    const isCorrect = val===S.target;
    const isHigh = val>S.target;

    if (S.mode !== 'solo') {
      sendData({ type:'GUESS', number:val, attempt:S.attempt, isHigh, correct:isCorrect });
    }

    // Side history panel (multi only)
    if (S.mode !== 'solo') {
        const hItem = document.createElement('div');
        const dirCls  = isCorrect ? 'correct' : (isHigh ? 'high' : 'low');
        const dirText = isCorrect ? 'Found it!' : (isHigh ? '↑ Too high' : '↓ Too low');
        hItem.className = `hc-item ${isCorrect ? 'correct' : ''} drop-anim`;
        hItem.innerHTML = `<span class="hc-item-num">${val}</span><span class="hc-item-badge ${dirCls}">${dirText}</span>`;
        $('hc-list').prepend(hItem);
        $('hc-att-num').textContent = S.attempt;
    }

    if (isCorrect) {
        handleWin(val);
    } else {
        updateRange(val, isHigh);
        fb.classList.remove('visible','high','low','correct'); void fb.offsetWidth;
        fb.textContent = isHigh?'Too high':'Too low';
        fb.classList.add('visible', isHigh?'high':'low');
        SFX.play(isHigh?'high':'low');

        let ht='';
        if(diff<=3) ht='Burning hot!'; else if(diff<=8) ht='Very warm'; else if(diff<=20) ht='Getting warmer'; else if(diff<=40) ht='Cold'; else ht='Freezing cold';
        sub.textContent=ht; sub.classList.add('visible');

        const bn=$('big-number'); bn.classList.remove('spring'); void bn.offsetWidth; bn.classList.add('spring'); setTimeout(()=>bn.classList.remove('spring'),500);
        updateBigNum();

        if (S.mode !== 'solo' && !S.oppFinished) { S.myTurn = false; updateTurnUI(); }
        if (S.mode==='solo' || S.myTurn) $('hidden-input').focus();
    }
  }

  function handleWin(val) {
      S.won=true; S.gameOver=true;
      clearInterval(S.timerInterval); S.elapsed=Date.now()-S.startTime;
      const score = calcScore(S.attempt, S.elapsed);
      S.myFinalData = { score, attempts:S.attempt, time:S.elapsed };

      const fb=$('feedback-text'), sub=$('feedback-sub');
      fb.textContent='Correct!'; fb.className='feedback-text correct visible';
      sub.textContent='You found it!'; sub.classList.add('visible');
      
      if(S.gameType === 'classic' || S.gameType === 'hotcold') {
          $('big-number-text').textContent=val; $('big-number').classList.remove('placeholder');
          $('big-number').style.color='#51cf66'; $('big-number-hint').textContent='';
      } else {
          $('cursor-blink').style.display = 'none';
          $('big-number-hint').textContent='';
      }

      SFX.play('win');
      $('game-container').classList.add('celebrate'); setTimeout(()=>$('game-container').classList.remove('celebrate'),700);
      
      let cx = window.innerWidth/2;
      let cy = window.innerHeight/2;
      burst(cx, cy, 30, ['#51cf66','#94d82d','#ffd43b','#4dabf7','#cc5de8','#ff6b6b']);

      if (S.mode !== 'solo') {
        S.iFinished = true; S.myTurn = false;
        sendData({ type:'FINISH', payload:S.myFinalData });
        S.roundResults.push(S.myFinalData);
        updateTurnUI();
        if (S.oppFinished) setTimeout(()=>{ checkShowResult(); }, 1600);
      } else {
        setTimeout(()=>{ checkShowResult(); }, 1600);
      }
  }

  function flashHeat(diff) {
    const f=$('heat-flash');
    let c;
    if(diff<=3) c='rgba(255,0,60,0.4)'; else if(diff<=8) c='rgba(255,100,0,0.3)';
    else if(diff<=20) c='rgba(255,170,0,0.15)'; else if(diff<=40) c='rgba(0,100,255,0.1)';
    else c='rgba(0,50,200,0.08)';
    f.style.background=c; f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash');
    setTimeout(()=>f.classList.remove('flash'),600);
  }

  function calcScore(att,ms) {
    const a=Math.max(0,Math.round(1000*(1-Math.log(att)/Math.log(20))));
    const tb=Math.max(0,Math.round(100*(1-Math.min(ms/1000,90)/90)));
    return Math.min(1000,a+tb);
  }

  // ===== RESULTS & REMATCH =====
  function checkShowResult() {
    if (!S.myFinalData) return;
    if (S.mode==='solo') { renderResult(); return; }

    if (S.oppFinalData) {
      S.oppRoundResults.push(S.oppFinalData);
      S.oppFinalData = null; // clear immediately — prevents double-processing if checkShowResult fires twice
      if (S.currentRound < S.rounds) {
        setTimeout(()=> startChoosing(), 1200);
      } else {
        document.body.classList.remove('multi-active');
        renderResult();
      }
    }
  }

  function renderResult() {
    const my = S.myFinalData;
    const score = S.mode==='solo' ? my.score : S.roundResults.reduce((s,r)=>s+r.score,0);
    const attempts = S.mode==='solo' ? my.attempts : S.roundResults.reduce((s,r)=>s+r.attempts,0);
    const time = S.mode==='solo' ? my.time : S.roundResults.reduce((s,r)=>s+r.time,0);

    $('result-score').textContent = score;
    $('result-score').className = 'result-score score-reveal';
    $('result-attempts').textContent = attempts;
    $('result-time').textContent = fmtTime(time);
    $('result-number').textContent = S.mode==='solo' ? (S.gameType === 'digits' ? S.targetStr : S.target) : S.rounds+'R';
    $('result-comment').textContent = getComment(S.mode==='solo'?score:Math.round(score/S.rounds), attempts);

    document.querySelectorAll('#result-screen .stagger-in').forEach(el=>{
      el.style.opacity='0'; el.classList.remove('stagger-in'); void el.offsetWidth; el.classList.add('stagger-in');
    });

    const vs=$('vs-card');
    if (S.mode==='solo') { 
        vs.classList.add('hidden'); 
        $('rematch-btn').textContent = 'Play Again';
    } else {
      vs.classList.remove('hidden');
      const oppScore = S.oppRoundResults.reduce((s,r)=>s+r.score,0);
      const oppAtt = S.oppRoundResults.reduce((s,r)=>s+r.attempts,0);

      $('vs-title').textContent = S.rounds>1 ? `Best of ${S.rounds}` : 'Final Result';
      $('vs-p1-name').textContent = S.playerName;
      $('vs-p1-score').textContent = score;
      $('vs-p1-att').textContent = attempts;
      $('vs-p2-name').textContent = S.oppName;
      $('vs-p2-score').textContent = oppScore;
      $('vs-p2-att').textContent = oppAtt;

      $('vs-p1-score').classList.remove('winner'); $('vs-p2-score').classList.remove('winner');
      if (score>oppScore) { $('vs-p1-score').classList.add('winner'); $('vs-winner').textContent=S.playerName+' wins!'; }
      else if (oppScore>score) { $('vs-p2-score').classList.add('winner'); $('vs-winner').textContent=S.oppName+' wins!'; }
      else $('vs-winner').textContent="It's a tie!";

      const rb = $('round-breakdown');
      if (S.rounds > 1 && S.roundResults.length > 0) {
        let html = '';
        for (let i = 0; i < S.roundResults.length; i++) {
          const my = S.roundResults[i], opp = S.oppRoundResults[i];
          if (!my || !opp) continue;
          const myW = my.score > opp.score, oppW = opp.score > my.score;
          html += `<div class="round-row"><span class="round-score${myW?' winner':''}">${my.score}</span><span class="round-label">R${i+1}</span><span class="round-score${oppW?' winner':''}">${opp.score}</span></div>`;
        }
        rb.innerHTML = html; rb.classList.remove('hidden');
      } else { rb.classList.add('hidden'); }

      $('rematch-btn').textContent = 'Rematch';
    }

    SFX.play('tick');
    show('result-screen');
  }

  function getComment(score) {
    if(score>=900) return ["Binary search energy.","Surgical precision.","Suspiciously good.","Your brain is overclocked."][rand(0,3)];
    if(score>=700) return ["Not bad. Just... adequate.","Solid. Like a B+ student.","You've done this before."][rand(0,2)];
    if(score>=400) return ["Mediocrity is a warm blanket.","Participation trophy unlocked.","Your intuition needs an update."][rand(0,2)];
    if(score>0) return ["Your brain is a broken calculator.","Did you try with your eyes closed?","A math teacher is crying somewhere."][rand(0,2)];
    return ["Your brain runs on dial-up.","404: Skill not found.","That was painful to watch."][rand(0,2)];
  }

  function playAgain() { 
      if (S.mode === 'solo') {
          startSolo();
      } else {
          SFX.play('click');
          S.iWantRematch = true;
          $('rematch-btn').textContent = 'Waiting...';
          $('rematch-btn').disabled = true;
          sendData({ type: 'REMATCH' });
          if (S.oppWantsRematch) restartMatch();
      }
  }
  
  function restartMatch() {
      S.currentRound = 0;
      S.roundResults = [];
      S.oppRoundResults = [];
      S.iWantRematch = false;
      S.oppWantsRematch = false;
      S._pendingOppReadyRound = 0;
      
      $('rematch-btn').disabled = false;
      startChoosing();
  }
  
  function _doQuit() {
      if (roomChannel) {
          roomChannel.unsubscribe().then(() => window.location.reload());
      } else {
          window.location.reload();
      }
  }

  function quitToMenu(confirmExit = false) {
      if (confirmExit) {
          showConfirm(
              'Are you sure you want to exit the current game?',
              () => { sendData({ type: 'QUIT' }); _doQuit(); },
          );
          return;
      }
      sendData({ type: 'QUIT' }); _doQuit();
  }
  
  function toggleSound() { const m=SFX.toggle(); $('sound-toggle').classList.toggle('muted',m); if(!m) SFX.play('click'); }

  document.addEventListener('DOMContentLoaded', init);

  return { setGameType, setMultiMode, startSolo, startMulti, setRounds, hostPlay, guestPlay, lockSecret, guess, clearInput, playAgain, quitToMenu, toggleTheme, toggleSound, show, resetGuestError };
})();