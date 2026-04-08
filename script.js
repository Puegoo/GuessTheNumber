const Game = (() => {
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
    gameType: 'classic', // 'classic' or 'digits'
    mode: 'solo', 
    target: 0, 
    targetStr: '', // for digits mode
    knownDigits: [null, null, null, null], // for digits mode
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
    
    // Multi
    peer: null, conn: null, roomCode: null, oppName: '', rounds: 3, currentRound: 0,
    mySecret: 0, oppSecret: 0, iAmReady: false, oppReady: false,
    myFinalData: null, oppFinalData: null, choosingInterval: null,
    roundResults: [], oppRoundResults: [],
    
    // Turn-based
    myTurn: false, iFinished: false, oppFinished: false,
    
    // Opp range
    oppRangeLow: 0, oppRangeHigh: 100
  };

  const $ = id => document.getElementById(id);

  function show(id) {
    SFX.play('whoosh');
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
    if (id === 'game-screen') $('hidden-input').focus();
  }

  function rand(a,b) { return Math.floor(Math.random()*(b-a+1))+a; }
  function fmtTime(ms) { const s=Math.floor(ms/1000); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }

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

  // ===== MODE TOGGLE =====
  function setGameType(type) {
    S.gameType = type;
    $('tab-classic').classList.toggle('active', type === 'classic');
    $('tab-digits').classList.toggle('active', type === 'digits');
    $('logo-mode-text').textContent = type === 'classic' ? 'Number' : 'PIN';
    $('intro-desc-text').innerHTML = type === 'classic' ? 
        'Znajdź ukrytą liczbę od 0 do 100.<br>Mniej prób = wyższy wynik.' : 
        'Odgadnij 4-cyfrowy kod PIN.<br>Zielone cyfry zostają na miejscu.';
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
    $('opp-range-low').textContent = S.gameType === 'digits' ? '' : '0';
    $('opp-range-high').textContent = S.gameType === 'digits' ? '' : '100';
    $('opp-arrow-l').textContent = S.gameType === 'digits' ? '' : 'low';
    $('opp-arrow-h').textContent = S.gameType === 'digits' ? '' : 'high';
    $('opp-range-current').textContent = '—';
    $('opp-range-current').className = 'opp-range-current';
    $('opp-range-hint').textContent = '';
    $('opp-range-hint').className = 'opp-range-hint';
  }

  function updateOppRange(val, isHigh, correct) {
    $('opp-range-current').textContent = val;
    if (correct) {
      $('opp-range-current').className = 'opp-range-current correct';
      $('opp-range-hint').textContent = 'Zgadł!';
      $('opp-range-hint').className = 'opp-range-hint correct';
    } else if (S.gameType === 'classic') {
      if (isHigh) {
        $('opp-range-current').className = 'opp-range-current high';
        $('opp-range-hint').textContent = '↓ Za dużo';
        $('opp-range-hint').className = 'opp-range-hint high';
        if (val < S.oppRangeHigh) { S.oppRangeHigh = val; $('opp-range-high').textContent = val; $('opp-range-high').className = 'opp-range-num high'; }
      } else {
        $('opp-range-current').className = 'opp-range-current low';
        $('opp-range-hint').textContent = '↑ Za mało';
        $('opp-range-hint').className = 'opp-range-hint low';
        if (val > S.oppRangeLow) { S.oppRangeLow = val; $('opp-range-low').textContent = val; $('opp-range-low').className = 'opp-range-num low'; }
      }
    } else {
        // Digits mode feedback for opp
        $('opp-range-current').className = 'opp-range-current';
        $('opp-range-hint').textContent = 'Próbuje...';
        $('opp-range-hint').className = 'opp-range-hint';
    }
  }

  // ===== TURN UI =====
  function updateTurnUI() {
    if (S.mode === 'solo') return;
    const tb = $('turn-badge'), tt = $('turn-text'), ot = $('opp-turn-pill'), otxt = $('opp-turn-text');
    tb.classList.remove('hidden');

    if (S.iFinished) {
      tb.className = 'turn-badge opp-turn'; tt.textContent = 'Koniec';
      $('classic-display').style.opacity = '0.3'; $('digits-display').style.opacity = '0.3';
      $('submit-row').style.opacity = '0.3'; $('submit-row').style.pointerEvents = 'none';
      
      ot.className = 'opp-turn-pill ' + (S.oppFinished ? 'done' : 'their-turn');
      otxt.textContent = S.oppFinished ? 'Koniec' : 'Zgaduje...';
      return;
    }

    if (S.myTurn) {
      tb.className = 'turn-badge my-turn'; tt.textContent = 'Twój ruch';
      $('classic-display').style.opacity = '1'; $('digits-display').style.opacity = '1';
      $('submit-row').style.opacity = '1'; $('submit-row').style.pointerEvents = 'auto';
      ot.className = 'opp-turn-pill your-turn'; otxt.textContent = 'Czeka';
    } else {
      tb.className = 'turn-badge opp-turn'; tt.textContent = "Ruch Gracza";
      $('classic-display').style.opacity = '0.4'; $('digits-display').style.opacity = '0.4';
      $('submit-row').style.opacity = '0.3'; $('submit-row').style.pointerEvents = 'none';
      S.typedValue = ''; updateBigNum();
      ot.className = 'opp-turn-pill their-turn'; otxt.textContent = 'Zgaduje...';
    }
  }

  // ===== INIT =====
  function init() {
    document.addEventListener('keydown', onKey);
    $('game-screen').addEventListener('click', ()=>{ if(!S.gameOver && (S.mode==='solo'||S.myTurn)) $('hidden-input').focus(); });
    $('host-name').addEventListener('input', onHostInput);
    $('host-name').addEventListener('keydown', e=>{ if(e.key==='Enter') hostPlay(); });
    $('guest-name').addEventListener('input', onGuestInput);
    $('guest-code').addEventListener('input', onGuestInput);
    $('guest-code').addEventListener('keydown', e=>{ if(e.key==='Enter') guestPlay(); });
  }

  // ===== PEER =====
  function initPeer(isHost, code) {
    return new Promise((resolve, reject) => {
      if (S.peer) return resolve(S.peer);
      let peerId = isHost ? 'gtn-' + Math.floor(100000 + Math.random() * 900000) : null;
      const p = peerId ? new Peer(peerId) : new Peer();
      p.on('open', ()=>{ S.peer=p; resolve(p); });
      p.on('error', e=>{ alert('Błąd połączenia. Spróbuj ponownie.'); console.error(e); });
    });
  }

  function setupConn() {
    S.conn.on('data', d => {
      if (d.type==='INIT') { 
          S.oppName=d.name; 
          S.rounds=d.rounds; 
          S.gameType=d.gameType; // Host narzuca zasady
          S.conn.send({type:'INIT_ACK',name:S.playerName}); 
          startChoosing(); 
      }
      else if (d.type==='INIT_ACK') { S.oppName=d.name; startChoosing(); }
      else if (d.type==='READY') { 
          if(S.gameType==='digits') S.oppSecretStr=d.secretStr; else S.oppSecret=d.secret; 
          S.oppReady=true; checkStartRound(); 
      }
      else if (d.type==='GUESS') { handleOppGuess(d); }
      else if (d.type==='FINISH') { S.oppFinalData=d.payload; S.oppFinished=true; updateTurnUI(); checkShowResult(); }
    });
  }

  // ===== SETUP =====
  function setRounds(n) {
    S.rounds = n;
    document.querySelectorAll('.round-pill').forEach(b => b.classList.toggle('active', +b.dataset.rounds===n));
    SFX.play('click');
  }

  function onHostInput() { $('setup-play-btn').disabled = !$('host-name').value.trim(); }
  function onGuestInput() { 
      $('guest-play-btn').disabled = !($('guest-name').value.trim() && $('guest-code').value.trim().length === 6); 
  }

  async function hostPlay() {
    S.playerName = $('host-name').value.trim();
    if (!S.playerName) return;
    SFX.play('click');
    S.mode = 'host';
    $('setup-play-btn').textContent = 'Tworzenie...';
    $('setup-play-btn').disabled = true;
    $('host-name').disabled = true;

    await initPeer(true);
    S.roomCode = S.peer.id.replace('gtn-', '');
    $('room-code-display').textContent = S.roomCode;
    $('room-code-box').classList.remove('hidden');
    $('host-wait-msg').style.display = 'block';
    $('setup-play-btn').style.display = 'none';

    S.peer.on('connection', c => { 
        S.conn = c; 
        c.on('open', () => {
            setupConn(); 
            // Host wysyła swoje zasady (Tryb + Rundy)
            c.send({ type:'INIT', name:S.playerName, rounds:S.rounds, gameType:S.gameType });
        });
    });
  }

  async function guestPlay() {
    S.playerName = $('guest-name').value.trim();
    const code = $('guest-code').value.trim();
    if (!S.playerName || code.length !== 6) return;
    SFX.play('click');
    $('guest-play-btn').textContent = 'Łączenie...';
    $('guest-play-btn').disabled = true;
    $('guest-name').disabled = true;
    $('guest-code').disabled = true;

    await initPeer(false);
    S.conn = S.peer.connect('gtn-' + code);
    S.conn.on('open', () => {
      setupConn();
      // Gość czeka na pakiet INIT od Hosta, który ustali zasady
    });
  }

  // ===== CHOOSING PHASE =====
  function startChoosing() {
    S.currentRound++;
    S.iAmReady = false; S.oppReady = false;
    S.myFinalData = null; S.oppFinalData = null;
    S.iFinished = false; S.oppFinished = false;

    document.body.classList.remove('multi-active');
    show('choose-screen');
    $('choose-status').innerHTML = `Runda ${S.currentRound}/${S.rounds} vs <b>${S.oppName}</b>`;
    
    if (S.gameType === 'digits') {
        $('secret-input').placeholder = "0000 - 9999";
    } else {
        $('secret-input').placeholder = "0 - 100";
    }
    
    $('secret-input').value = ''; $('secret-input').disabled = false;
    $('lock-btn').disabled = false; $('lock-btn').textContent = 'Zatwierdź';

    const deadline = Date.now() + 30000;
    clearInterval(S.choosingInterval);
    S.choosingInterval = setInterval(()=>{
      const remaining = Math.max(0, deadline - Date.now());
      const sec = Math.floor(remaining / 1000);
      const ms = remaining % 1000;
      $('choose-sec').textContent = sec;
      $('choose-ms').textContent = '.' + String(ms).padStart(3, '0');
      if (remaining <= 0) { clearInterval(S.choosingInterval); if(!S.iAmReady) lockSecret(); }
    }, 37);
  }

  function lockSecret() {
    if (S.iAmReady) return;
    SFX.play('click');
    
    if (S.gameType === 'digits') {
        let v = $('secret-input').value.trim();
        if(v.length === 0) v = String(rand(0, 9999)).padStart(4, '0');
        v = v.substring(0,4).padStart(4, '0');
        $('secret-input').value = v;
        S.mySecretStr = v;
        S.conn.send({ type:'READY', secretStr:S.mySecretStr });
    } else {
        let v = parseInt($('secret-input').value, 10);
        if (isNaN(v)||v<0||v>100) { v=rand(0,100); $('secret-input').value=v; }
        S.mySecret = v;
        S.conn.send({ type:'READY', secret:S.mySecret });
    }

    S.iAmReady = true;
    $('secret-input').disabled = true;
    $('lock-btn').disabled = true;
    $('lock-btn').textContent = 'Czekam...';
    checkStartRound();
  }

  function checkStartRound() {
    if (!S.iAmReady || !S.oppReady) return;
    clearInterval(S.choosingInterval);
    
    if (S.gameType === 'digits') {
        S.targetStr = S.oppSecretStr;
    } else {
        S.target = S.oppSecret;
    }
    
    resetGameUI();
    resetRange();
    resetOppRange();

    S.myTurn = (S.mode === 'host');
    S.iFinished = false;
    S.oppFinished = false;

    document.body.classList.add('multi-active');
    $('opp-card-name').textContent = S.oppName;
    $('opp-card-att').textContent = '0';
    $('opp-card-chips').innerHTML = '';

    const rb = $('round-badge');
    if (S.rounds > 1) { rb.classList.remove('hidden'); rb.textContent = `Runda ${S.currentRound}/${S.rounds}`; }
    else rb.classList.add('hidden');

    updateTurnUI();
    show('game-screen');
    startTimer();
  }

  function handleOppGuess(d) {
    $('opp-card-att').textContent = d.attempt;
    
    const chip = document.createElement('div');
    if (S.gameType === 'digits') {
        updateOppRange(d.numberStr, false, d.correct); // numberStr will have masked format e.g. "1*3*"
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

    if (d.correct) {
      S.oppFinished = true;
      if (!S.iFinished) { S.myTurn = true; updateTurnUI(); SFX.play('turn'); }
    } else {
      if (!S.iFinished) { S.myTurn = true; updateTurnUI(); SFX.play('turn'); }
    }
  }

  // ===== KEYBOARD & UI UPDATES =====
  function onKey(e) {
    const scr = document.querySelector('.screen.active');
    if (scr && scr.id === 'choose-screen' && e.key === 'Enter') { lockSecret(); return; }
    if (!scr || scr.id !== 'game-screen' || S.gameOver) return;
    if (S.mode !== 'solo' && !S.myTurn) return;
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
    if (S.gameType === 'digits') {
        let typeIdx = 0;
        for (let i = 0; i < 4; i++) {
            const box = $(`pin-${i}`);
            box.classList.remove('locked', 'active');
            if (S.knownDigits[i] !== null) {
                box.textContent = S.knownDigits[i];
                box.classList.add('locked');
            } else {
                if (S.typedValue[typeIdx]) {
                    box.textContent = S.typedValue[typeIdx];
                    box.classList.add('active');
                    typeIdx++;
                } else {
                    box.textContent = '_';
                }
            }
        }
    } else {
        const el=$('big-number'), txt=$('big-number-text'), hint=$('big-number-hint');
        if (!S.typedValue) {
          txt.textContent='?'; el.classList.add('placeholder');
          if(S.mode==='solo'||S.myTurn) { hint.textContent='wpisz liczbę'; hint.style.opacity='1'; }
        } else {
          txt.textContent=S.typedValue; el.classList.remove('placeholder');
          hint.textContent='wciśnij enter'; hint.style.opacity='0.4';
          el.classList.remove('num-slide-in'); void el.offsetWidth; el.classList.add('num-slide-in');
        }
    }
  }

  function clearInput() {
    if (S.mode !== 'solo' && !S.myTurn) return;
    S.typedValue=''; SFX.play('delete'); updateBigNum();
  }

  // ===== GAME PLAY =====
  function resetGameUI() {
    S.attempt=0; S.won=false; S.gameOver=false; S.elapsed=0; S.typedValue=''; S.myFinalData=null;
    S.knownDigits = [null, null, null, null];
    $('att-num').textContent='0'; $('game-timer').textContent='00:00';
    $('hidden-input').value='';
    
    if (S.gameType === 'digits') {
        $('classic-display').classList.add('hidden');
        $('digits-display').classList.remove('hidden');
        $('history-container').classList.remove('hidden');
        $('history-container').innerHTML = '';
        $('submit-row').style.opacity='1'; $('submit-row').style.pointerEvents='auto';
    } else {
        $('classic-display').classList.remove('hidden');
        $('digits-display').classList.add('hidden');
        $('history-container').classList.add('hidden');
        $('classic-display').style.opacity='1';
        $('submit-row').style.opacity='1'; $('submit-row').style.pointerEvents='auto';
    }
    
    updateBigNum();
    $('feedback-text').textContent=''; $('feedback-text').className='feedback-text';
    $('feedback-sub').textContent=''; $('feedback-sub').classList.remove('visible');
    $('turn-badge').classList.add('hidden');
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
    resetGameUI(); resetRange(); show('game-screen'); startTimer();
  }

  function startMulti() {
    SFX.play('click'); S.mode='host';
    S.currentRound=0; S.roundResults=[]; S.oppRoundResults=[];
    $('host-name').value=''; $('host-name').disabled=false;
    $('room-code-box').classList.add('hidden');
    $('setup-play-btn').style.display='flex'; $('setup-play-btn').disabled=true; $('setup-play-btn').textContent='Utwórz pokój';
    $('host-wait-msg').style.display='none';
    setRounds(3);
    show('setup-screen');
    setTimeout(()=>$('host-name').focus(),400);
  }

  function shakeUI() {
      $('game-container').classList.remove('earthquake'); void $('game-container').offsetWidth;
      $('game-container').classList.add('earthquake'); setTimeout(()=>$('game-container').classList.remove('earthquake'),500);
      SFX.play('tick');
  }

  function guess() {
    if (S.mode !== 'solo' && !S.myTurn) return;
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

        S.knownDigits = newKnown;
        S.typedValue = '';
        updateBigNum();

        if (S.mode !== 'solo') {
            S.conn.send({ type:'GUESS', numberStr:maskedOppStr, attempt:S.attempt, correct:isCorrect });
        }

        if (isCorrect) {
            handleWin(guessArr.join(''));
        } else {
            // Dodaj do historii
            const hist = document.createElement('div');
            hist.className = 'history-item';
            guessArr.forEach((char, i) => {
               const span = document.createElement('span');
               span.textContent = char;
               if (S.knownDigits[i] !== null) span.classList.add('correct');
               hist.appendChild(span);
            });
            $('history-container').prepend(hist);
            SFX.play('low');

            if (S.mode !== 'solo' && !S.oppFinished) { S.myTurn = false; updateTurnUI(); }
            if (S.mode==='solo' || S.myTurn) $('hidden-input').focus();
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
      S.conn.send({ type:'GUESS', number:val, attempt:S.attempt, isHigh, correct:isCorrect });
    }

    if (isCorrect) {
        handleWin(val);
    } else {
        updateRange(val, isHigh);
        fb.classList.remove('visible','high','low','correct'); void fb.offsetWidth;
        fb.textContent = isHigh?'Za dużo':'Za mało';
        fb.classList.add('visible', isHigh?'high':'low');
        SFX.play(isHigh?'high':'low');

        let ht='';
        if(diff<=3) ht='Gorąco!'; else if(diff<=8) ht='Bardzo ciepło'; else if(diff<=20) ht='Ciepło'; else if(diff<=40) ht='Zimno'; else ht='Mróz';
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
      fb.textContent='Zgadłeś!'; fb.className='feedback-text correct visible';
      sub.textContent='Udało się!'; sub.classList.add('visible');
      
      if(S.gameType === 'classic') {
          $('big-number-text').textContent=val; $('big-number').classList.remove('placeholder');
          $('big-number').style.color='#51cf66'; $('big-number-hint').textContent='';
      }

      SFX.play('win');
      $('game-container').classList.add('celebrate'); setTimeout(()=>$('game-container').classList.remove('celebrate'),700);
      
      // Burst effect
      let cx = window.innerWidth/2;
      let cy = window.innerHeight/2;
      burst(cx, cy, 30, ['#51cf66','#94d82d','#ffd43b','#4dabf7','#cc5de8','#ff6b6b']);

      if (S.mode !== 'solo') {
        S.iFinished = true; S.myTurn = false;
        S.conn.send({ type:'FINISH', payload:S.myFinalData });
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

  // ===== RESULTS =====
  function checkShowResult() {
    if (!S.myFinalData) return;
    if (S.mode==='solo') { renderResult(); return; }

    if (S.oppFinalData) {
      S.oppRoundResults.push(S.oppFinalData);
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
    if (S.mode==='solo') { vs.classList.add('hidden'); }
    else {
      vs.classList.remove('hidden');
      const oppScore = S.oppRoundResults.reduce((s,r)=>s+r.score,0);
      const oppAtt = S.oppRoundResults.reduce((s,r)=>s+r.attempts,0);

      $('vs-title').textContent = S.rounds>1 ? `Najlepszy z ${S.rounds}` : 'Wynik końcowy';
      $('vs-p1-name').textContent = S.playerName;
      $('vs-p1-score').textContent = score;
      $('vs-p1-att').textContent = attempts;
      $('vs-p2-name').textContent = S.oppName;
      $('vs-p2-score').textContent = oppScore;
      $('vs-p2-att').textContent = oppAtt;

      $('vs-p1-score').classList.remove('winner'); $('vs-p2-score').classList.remove('winner');
      if (score>oppScore) { $('vs-p1-score').classList.add('winner'); $('vs-winner').textContent=S.playerName+' wygrywa!'; }
      else if (oppScore>score) { $('vs-p2-score').classList.add('winner'); $('vs-winner').textContent=S.oppName+' wygrywa!'; }
      else $('vs-winner').textContent="Remis!";
    }

    SFX.play('tick');
    show('result-screen');
  }

  function getComment(score) {
    if(score>=900) return ["Energia Binary Search.","Chirurgiczna precyzja.","Podejrzanie dobrze.","Twój mózg jest podkręcony."][rand(0,3)];
    if(score>=700) return ["Nieźle. Po prostu... wystarczająco.","Solidnie. Jak uczeń na czwórkę z plusem.","Robiłeś to już wcześniej."][rand(0,2)];
    if(score>=400) return ["Przeciętność to ciepły kocyk.","Odblokowano puchar za uczestnictwo.","Twoja intuicja potrzebuje aktualizacji."][rand(0,2)];
    if(score>0) return ["Twój mózg to zepsuty kalkulator.","Próbowałeś z zamkniętymi oczami?","Gdzieś płacze nauczyciel matematyki."][rand(0,2)];
    return ["Masz dial-up zamiast mózgu.","Błąd 404: Nie znaleziono skilla.","Aż bolało patrzeć."][rand(0,2)];
  }

  function playAgain() { 
      window.location.reload(); 
  }
  
  function toggleSound() { const m=SFX.toggle(); $('sound-toggle').classList.toggle('muted',m); if(!m) SFX.play('click'); }

  document.addEventListener('DOMContentLoaded', init);

  return { setGameType, startSolo, startMulti, setRounds, hostPlay, guestPlay, lockSecret, guess, clearInput, playAgain, toggleSound, show };
})();