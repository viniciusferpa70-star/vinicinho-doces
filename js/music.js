/* Audio lives outside <main> so navigation never interrupts playback. */
(() => {
  'use strict';
  const CHUNK_SIZE = 512 * 1024, MAX_SIZE = 25 * 1024 * 1024;
  const types = {mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',oga:'audio/ogg',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',webm:'audio/webm',opus:'audio/ogg'};
  const audio = new Audio();
  audio.preload = 'metadata';
  let db, tracksRef, playlistsRef, tracks = [], remoteTracks = [], playlists = [], selected = '', search = '';
  const pendingTracks = new Map();
  let started = false, loaded = false, importing = false, status = '', current = null, queue = [], sequence = 0, objectUrl = null;
  let shuffle = false, repeat = false, player, loading = false;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}` : '0:00';
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const button = (action, label, name) => `<button type="button" data-music="${action}" title="${label}" aria-label="${label}">${icon(name)}</button>`;
  const page = () => document.getElementById('musicPage');
  const errorText = error => {
    if (String(error.code).includes('resource-exhausted')) return 'A cota do Firebase foi atingida. Tente novamente após a renovação da cota.';
    if (String(error.code).includes('permission-denied')) return 'Sem permissão para acessar as músicas. Entre com a conta autorizada.';
    if (String(error.code).includes('unavailable')) return 'Sem conexão com o Firebase. Verifique a internet e tente novamente.';
    return error.message || 'Não foi possível concluir. Tente novamente.';
  };
  function message(text) {
    status = text;
    const el = document.getElementById('musicStatus');
    if (el) el.textContent = text;
    if (player) player.querySelector('.music-player-status').textContent = text;
  }
  pages['Músicas'] = `<section class="page-shell music-page" id="musicPage"></section>`;

  function syncTracks() {
    const combined = new Map(remoteTracks.map(track => [track.id, track]));
    for (const [id, track] of pendingTracks) combined.set(id, track);
    tracks = [...combined.values()].sort((a,b) => a.title.localeCompare(b.title,'pt-BR'));
  }
  function playable(track) { return track.status === 'ready' || !!pendingTracks.get(track.id)?.file; }
  function trackStatus(track) {
    if (track.status === 'ready') return 'Salva no Firebase';
    if (track.status === 'error') return `Envio não concluído: ${track.error}`;
    if (track.status === 'queued') return 'Na fila de envio · já pode reproduzir';
    if (pendingTracks.has(track.id)) return `${track.phase || 'Enviando ao Firebase'} · ${track.progress || 0}%`;
    return 'Envio interrompido · selecione o arquivo novamente para concluir';
  }
  function cloudRequest(promise) {
    let timer;
    return Promise.race([promise, new Promise((_,reject) => {
      timer = setTimeout(() => reject(Error('O envio demorou demais. Verifique a conexão e use Tentar novamente.')), 60000);
    })]).finally(() => clearTimeout(timer));
  }

  function visibleTracks() {
    const list = playlists.find(item => item.id === selected);
    const available = list ? tracks.filter(t => (list.trackIds || []).includes(t.id) || pendingTracks.get(t.id)?.playlistId === selected) : tracks;
    const term = search.toLocaleLowerCase('pt-BR');
    return available.filter(t => `${t.title} ${t.fileName}`.toLocaleLowerCase('pt-BR').includes(term));
  }
  function renderList() {
    const root = page();
    if (!root) return;
    const visible = visibleTracks();
    root.querySelector('.music-track-list').innerHTML = visible.map((t, i) => `<div class="music-track ${current?.id === t.id ? 'is-playing' : ''}">
      <button type="button" class="music-track-play" data-track="${escape(t.id)}" aria-label="Reproduzir ${escape(t.title)}" ${playable(t) ? '' : 'disabled'}>${icon('play')}</button>
      <span class="music-track-title"><b>${escape(t.title)}</b><small>${escape(t.folder || t.fileName)}</small><small class="music-save-state ${t.status === 'error' ? 'music-save-error' : ''}">${escape(trackStatus(t))}</small>${pendingTracks.has(t.id) && t.status !== 'error' ? `<progress max="100" value="${t.progress || 0}" aria-label="Progresso do envio de ${escape(t.title)}"></progress>` : ''}</span>
      <span class="music-size">${(t.size/1048576).toFixed(1)} MB</span><span>${time(t.duration)}</span>
      ${t.status === 'error' || (!pendingTracks.has(t.id) && t.status !== 'ready') ? `<button type="button" class="music-retry" data-retry="${escape(t.id)}" ${importing ? 'disabled' : ''}>Tentar novamente</button>` : ''}
      <button type="button" data-add="${escape(t.id)}" title="Adicionar à playlist" aria-label="Adicionar ${escape(t.title)} à playlist" ${t.status === 'ready' ? '' : 'disabled'}>${icon('list-plus')}</button>
      ${selected && t.status === 'ready' ? `<button type="button" data-remove="${escape(t.id)}" title="Remover da playlist" aria-label="Remover ${escape(t.title)} da playlist">${icon('x')}</button>` : ''}</div>`).join('') || `<div class="music-empty">${icon('music-2')}<h2>${loaded ? (search ? 'Nenhuma música encontrada' : 'Sua trilha sonora começa aqui') : 'Carregando biblioteca…'}</h2><p>${search ? 'Tente outro nome.' : 'Importe músicas do computador ou adicione faixas a esta playlist.'}</p></div>`;
    root.querySelector('.music-count').textContent = `${visible.length} música${visible.length === 1 ? '' : 's'}`;
    window.lucide?.createIcons();
  }
  function render() {
    const root = page();
    if (!root) return;
    const list = playlists.find(item => item.id === selected);
    root.innerHTML = `<div class="page-head"><div><h1>Músicas</h1><p>Sua trilha sonora, em qualquer tela.</p></div><button type="button" class="outline-btn" data-music="menu">☰ Menu</button></div>
      <div class="music-hero"><div class="music-cover">${icon('headphones')}</div><div><small>SUA BIBLIOTECA</small><h2>${escape(list?.name || 'Dê ritmo ao seu dia')}</h2><p>Músicas e playlists salvas na sua conta.</p><span class="music-count"></span></div></div>
      <div class="music-toolbar"><button type="button" class="primary-btn" data-music="play-all">${icon('play')} Reproduzir</button><button type="button" class="outline-btn" data-music="files" ${importing ? 'disabled' : ''}>${icon('upload')} Importar músicas</button><button type="button" class="outline-btn" data-music="folder" ${importing ? 'disabled' : ''}>${icon('folder-open')} Importar pasta</button><button type="button" class="outline-btn" data-music="new">${icon('plus')} Nova playlist</button></div>
      <p class="music-hint">MP3, M4A, WAV, OGG, AAC, FLAC e WebM · até 25 MB por música. Você pode ouvir durante o envio. Espere aparecer “Salva no Firebase” antes de fechar o site.</p>
      <p id="musicStatus" class="music-status" role="status" aria-live="polite">${escape(status)}</p>
      <div class="music-layout"><aside class="music-library"><h3>Playlists</h3><button type="button" data-playlist="" class="${!selected ? 'selected' : ''}">${icon('library')} Todas as músicas <span>${tracks.length}</span></button>${playlists.map(p => `<button type="button" data-playlist="${escape(p.id)}" class="${selected === p.id ? 'selected' : ''}">${icon('list-music')} <span>${escape(p.name)}</span><small>${(p.trackIds || []).length}</small></button>`).join('')}</aside>
      <div class="panel music-results"><div class="music-list-head"><h2>${escape(list?.name || 'Todas as músicas')}</h2><input type="search" class="music-search" aria-label="Buscar músicas" placeholder="Buscar músicas…" value="${escape(search)}"></div><div class="music-track-list"></div></div></div>`;
    root.querySelector('.music-search').oninput = e => { search = e.target.value; renderList(); };
    root.onclick = e => {
      const el = e.target.closest('button');
      if (!el) return;
      if (el.hasAttribute('data-playlist')) { selected = el.dataset.playlist; search = ''; render(); }
      if (el.dataset.track) play(el.dataset.track, visibleTracks().map(t => t.id));
      if (el.dataset.add) choosePlaylist(el.dataset.add);
      if (el.dataset.remove) removeFromPlaylist(el.dataset.remove);
      if (el.dataset.retry) {
        const pending = pendingTracks.get(el.dataset.retry);
        if (pending?.file) importFiles([pending.file], pending.playlistId);
        else chooseFiles(false);
      }
      const action = el.dataset.music;
      if (action === 'files' || action === 'folder') chooseFiles(action === 'folder');
      if (action === 'new') newPlaylist();
      if (action === 'play-all') { const ready = visibleTracks().filter(playable); if (ready.length) play(ready[0].id, ready.map(t => t.id)); }
      if (action === 'menu') document.getElementById('sidebar').classList.add('open');
    };
    renderList();
  }
  async function mount() {
    if (!page()) return;
    render();
    if (started) return;
    started = true;
    try {
      await window.VinicinhoCloud.ready;
      db = firebase.firestore();
      const root = db.collection('businesses').doc('vinicinho-doces');
      tracksRef = root.collection('musicTracks');
      playlistsRef = root.collection('musicPlaylists');
      tracksRef.onSnapshot(snapshot => {
        remoteTracks = snapshot.docs.map(d => ({...d.data(), id:d.id}));
        syncTracks();
        loaded = true; render();
      }, e => message(errorText(e)));
      playlistsRef.onSnapshot(snapshot => {
        playlists = snapshot.docs.map(d => ({...d.data(), id:d.id})).sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
        render();
      }, e => message(errorText(e)));
      firebase.auth().onAuthStateChanged(user => { if (!user) { ++sequence; audio.pause(); audio.removeAttribute('src'); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; current = null; if (player) player.hidden = true; document.body.classList.remove('has-music-player'); } });
    } catch (e) { started = false; message(errorText(e)); }
  }
  function dialog(title, content, submitLabel, submit) {
    const el = document.createElement('dialog');
    el.className = 'music-dialog';
    el.innerHTML = `<form><h2>${escape(title)}</h2>${content}<p role="status"></p><div><button type="button" class="outline-btn">Cancelar</button><button type="submit" class="primary-btn">${escape(submitLabel)}</button></div></form>`;
    document.body.appendChild(el);
    el.querySelector('button[type=button]').onclick = () => el.close();
    el.onclose = () => el.remove();
    el.querySelector('form').onsubmit = async e => {
      e.preventDefault(); const btn = el.querySelector('[type=submit]'); btn.disabled = true;
      try { await submit(new FormData(e.target)); el.close(); } catch (error) { el.querySelector('[role=status]').textContent = errorText(error); btn.disabled = false; }
    };
    el.showModal();
  }
  function newPlaylist() {
    if (!playlistsRef) return message('Aguarde o carregamento da biblioteca.');
    dialog('Nova playlist', '<label>Nome da playlist<input name="name" required maxlength="80" placeholder="Ex.: Música para trabalhar" autofocus></label>', 'Criar playlist', async data => {
      const name = data.get('name').trim(); if (!name) throw Error('Digite o nome da playlist.');
      const ref = await playlistsRef.add({name,trackIds:[],createdAt:firebase.firestore.FieldValue.serverTimestamp()}); selected = ref.id; render(); message('Playlist salva no Firebase.');
    });
  }
  function choosePlaylist(id) {
    if (!playlists.length) { message('Crie uma playlist antes de adicionar músicas.'); return newPlaylist(); }
    dialog('Adicionar à playlist', `<label>Playlist<select name="playlist">${playlists.map(p => `<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('')}</select></label>`, 'Adicionar', async data => {
      await playlistsRef.doc(data.get('playlist')).update({trackIds:firebase.firestore.FieldValue.arrayUnion(id)}); message('Música adicionada à playlist.');
    });
  }
  async function removeFromPlaylist(id) {
    try { await playlistsRef.doc(selected).update({trackIds:firebase.firestore.FieldValue.arrayRemove(id)}); message('Música removida da playlist. Ela continua na biblioteca.'); } catch(e) { message(errorText(e)); }
  }
  function chooseFiles(folder) {
    if (importing) return;
    if (!tracksRef) return message('Aguarde a conexão com o Firebase e tente novamente.');
    const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = 'audio/*,.mp3,.m4a,.wav,.ogg,.oga,.aac,.flac,.webm,.opus';
    if (folder) input.setAttribute('webkitdirectory','');
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => { const files = Array.from(input.files || []); input.remove(); if(files.length) importFiles(files); };
    input.oncancel = () => input.remove();
    input.click();
  }
  async function durationOf(file) {
    return new Promise(resolve => {
      const probe = new Audio(), url = URL.createObjectURL(file);
      const finish = value => { clearTimeout(timer); probe.onloadedmetadata = probe.onerror = null; probe.removeAttribute('src'); URL.revokeObjectURL(url); resolve(value); };
      const timer = setTimeout(() => finish(0), 5000);
      probe.onloadedmetadata = () => finish(Number.isFinite(probe.duration) ? probe.duration : 0);
      probe.onerror = () => finish(0); probe.src = url;
    });
  }
  async function importFiles(files, destination = selected) {
    if (importing || !tracksRef) return;
    importing = true;
    search = '';
    let saved = 0, skipped = 0, failed = 0;
    const failures = [];
    const entries = [];
    for (const file of files) {
      const mime = types[file.name.split('.').pop().toLowerCase()] || (file.type.startsWith('audio/') ? file.type : '');
      if (!mime) { skipped++; continue; }
      const previous = [...pendingTracks.values()].find(t => t.file === file);
      const entry = previous || {id:`local-${crypto.randomUUID()}`,title:file.name.replace(/\.[^.]+$/,''),fileName:file.name,folder:(file.webkitRelativePath || '').split('/').slice(0,-1).join('/'),size:file.size,mime,duration:0,file,playlistId:destination};
      Object.assign(entry,{status:'queued',progress:0,error:''});
      pendingTracks.set(entry.id,entry); entries.push(entry);
    }
    syncTracks(); render();
    message(entries.length ? `${entries.length} música(s) selecionada(s). Você já pode reproduzir enquanto o envio é concluído. Mantenha o site aberto.` : 'Nenhum arquivo de áudio encontrado. Escolha MP3, M4A, WAV, OGG, AAC, FLAC ou WebM.');
    try {
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index], file = entry.file, mime = entry.mime;
        let ref, chunkCount = 0, complete = false;
        try {
          if (!file.size || file.size > MAX_SIZE) throw Error('Arquivo vazio ou maior que 25 MB.');
          if (!audio.canPlayType(mime)) throw Error('Este formato não é reproduzido neste navegador.');
          entry.status = 'uploading'; entry.phase = 'Preparando arquivo'; renderList();
          message(`Preparando ${index+1}/${entries.length}: ${file.name}`);
          const bytes = new Uint8Array(await file.arrayBuffer());
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b => b.toString(16).padStart(2,'0')).join('');
          const oldId = entry.id;
          pendingTracks.delete(oldId); entry.id = hash; pendingTracks.set(hash, entry);
          if (current?.id === oldId) current = entry;
          queue = queue.map(id => id === oldId ? hash : id);
          syncTracks(); renderList();
          // Deterministic IDs make retries safe and avoid importing the same audio twice.
          ref = tracksRef.doc(hash);
          const existing = await cloudRequest(ref.get({source:'server'}));
          if (existing.exists && existing.data().status === 'ready') {
            complete = true;
            remoteTracks = [...remoteTracks.filter(t => t.id !== hash), {...existing.data(),id:hash}];
            if (destination) await cloudRequest(playlistsRef.doc(destination).update({trackIds:firebase.firestore.FieldValue.arrayUnion(hash)}));
            pendingTracks.delete(hash); syncTracks(); render();
            skipped++; continue;
          }
          chunkCount = Math.ceil(bytes.length / CHUNK_SIZE);
          const metadata = {title:file.name.replace(/\.[^.]+$/,''),fileName:file.name,folder:(file.webkitRelativePath || '').split('/').slice(0,-1).join('/'),size:file.size,mime,chunkCount,duration:await durationOf(file),status:'uploading',createdAt:firebase.firestore.FieldValue.serverTimestamp()};
          entry.duration = metadata.duration;
          await cloudRequest(ref.set(metadata));
          for (let offset = 0; offset < chunkCount; offset += 2) {
            entry.phase = navigator.onLine ? 'Enviando ao Firebase' : 'Aguardando conexão'; renderList();
            message(`Enviando ${index+1}/${entries.length}: ${file.name} — ${entry.progress}%`);
            const batch = db.batch();
            for (let n = offset; n < Math.min(offset+2, chunkCount); n++) batch.set(ref.collection('musicChunks').doc(String(n).padStart(4,'0')), {index:n,data:firebase.firestore.Blob.fromUint8Array(bytes.slice(n*CHUNK_SIZE,(n+1)*CHUNK_SIZE))});
            await cloudRequest(batch.commit());
            entry.progress = Math.round(Math.min(offset+2,chunkCount)/chunkCount*100); renderList();
          }
          entry.phase = 'Confirmando salvamento'; renderList();
          await cloudRequest(ref.update({status:'ready'})); complete = true; saved++;
          remoteTracks = [...remoteTracks.filter(t => t.id !== entry.id), {...metadata,id:entry.id,status:'ready'}];
          if (destination) await cloudRequest(playlistsRef.doc(destination).update({trackIds:firebase.firestore.FieldValue.arrayUnion(ref.id)}));
          pendingTracks.delete(entry.id); syncTracks(); render(); updatePlayer();
        } catch(error) {
          entry.status = 'error'; entry.error = errorText(error); syncTracks(); renderList();
          failed++; failures.push(`${file.name}: ${errorText(error)}${complete ? ' A música está salva na biblioteca, mas não foi adicionada à playlist.' : ''}`);
          // Keep incomplete blocks hidden; the same content hash resumes/overwrites on retry.
        }
      }
    } finally {
      importing = false;
      message(`${saved} salva(s) no Firebase; ${skipped} já existente(s) ou arquivo(s) não musical(is); ${failed} falha(s).${!entries.length ? ' Nenhuma música compatível foi encontrada na seleção.' : ''}${failures.length ? ' '+failures.join(' | ') : ''}`);
      render();
    }
  }
  function ensurePlayer() {
    if (player) { player.hidden = false; document.body.classList.add('has-music-player'); return; }
    player = document.createElement('section'); player.className = 'music-player'; player.setAttribute('aria-label','Player de música');
    player.innerHTML = `<div class="music-now"><span class="music-art">${icon('music-2')}</span><div><b class="music-now-title"></b><small class="music-now-subtitle">Sua biblioteca</small></div>${button('library','Abrir músicas','list-music')}</div><div class="music-transport"><div class="music-controls">${button('shuffle','Aleatório','shuffle')}${button('previous','Música anterior','skip-back')}${button('toggle','Reproduzir','play')}${button('next','Próxima música','skip-forward')}${button('repeat','Repetir playlist','repeat')}</div><div class="music-progress"><span class="music-elapsed">0:00</span><input type="range" min="0" max="100" value="0" step="0.1" aria-label="Posição da música"><span class="music-duration">0:00</span></div></div><div class="music-volume">${button('mute','Silenciar','volume-2')}<input type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume">${button('close','Fechar player','x')}</div><span class="music-player-status" role="status" aria-live="polite"></span>`;
    document.body.appendChild(player); document.body.classList.add('has-music-player');
    player.onclick = e => {
      const action = e.target.closest('[data-music]')?.dataset.music;
      if (action === 'toggle') { if (loading) return; if (!audio.src && current) { play(current.id); return; } if (audio.paused) audio.play().catch(e => message(errorText(e))); else audio.pause(); }
      if (action === 'previous') { if (audio.currentTime > 3) audio.currentTime = 0; else next(-1); }
      if (action === 'next') next(1);
      if (action === 'shuffle') shuffle = !shuffle;
      if (action === 'repeat') repeat = !repeat;
      if (action === 'mute') audio.muted = !audio.muted;
      if (action === 'library') window.openPage('Músicas');
      if (action === 'close') { ++sequence; audio.pause(); audio.removeAttribute('src'); audio.load(); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; current = null; loading = false; player.hidden = true; document.body.classList.remove('has-music-player'); renderList(); }
      updatePlayer();
    };
    player.querySelector('.music-progress input').oninput = e => { if(Number.isFinite(audio.duration)) audio.currentTime = +e.target.value; };
    player.querySelector('.music-volume input').oninput = e => { audio.volume = +e.target.value; audio.muted = false; updatePlayer(); };
  }
  function updatePlayer() {
    if (!player) return;
    player.querySelector('.music-now-title').textContent = current?.title || '';
    player.querySelector('.music-now-subtitle').textContent = loading ? 'Carregando áudio…' : `${audio.paused ? 'Pausado' : 'Reproduzindo'}${pendingTracks.has(current?.id) ? ' · salvamento pendente' : ''}`;
    const toggle = player.querySelector('[data-music=toggle]');
    toggle.innerHTML = icon(audio.paused ? 'play' : 'pause'); toggle.disabled = loading;
    toggle.setAttribute('aria-label',audio.paused ? 'Reproduzir' : 'Pausar'); toggle.title = toggle.getAttribute('aria-label');
    for (const [key,value] of [['shuffle',shuffle],['repeat',repeat]]) { const el=player.querySelector(`[data-music=${key}]`); el.setAttribute('aria-pressed',String(value)); }
    const mute = player.querySelector('[data-music=mute]'); mute.innerHTML = icon(audio.muted || !audio.volume ? 'volume-x' : 'volume-2'); mute.setAttribute('aria-label',audio.muted ? 'Ativar som' : 'Silenciar');
    window.lucide?.createIcons();
  }
  async function play(id, newQueue) {
    const track = tracks.find(t => t.id === id); if (!track) return;
    if (!playable(track)) return message('O envio desta música foi interrompido. Use Tentar novamente e selecione o arquivo original.');
    const ticket = ++sequence; if (newQueue) queue = newQueue.slice();
    if (current?.id === id && objectUrl && !loading && audio.readyState >= 1) {
      audio.currentTime = 0;
      try { await audio.play(); if (!importing) message(''); } catch(e) { message(errorText(e)); }
      return;
    }
    audio.pause(); audio.removeAttribute('src'); audio.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
    current = track; loading = true; ensurePlayer(); updatePlayer(); renderList(); if (!importing) message('Carregando música…');
    try {
      let blob = pendingTracks.get(id)?.file;
      if (!blob) {
        const snapshot = await cloudRequest(tracksRef.doc(id).collection('musicChunks').orderBy('index').get({source:'server'}));
        if (ticket !== sequence) return;
        if (snapshot.size !== track.chunkCount) throw Error('Arquivo incompleto. Importe esta música novamente.');
        blob = new Blob(snapshot.docs.map(d => d.data().data.toUint8Array()),{type:track.mime});
        if (blob.size !== track.size) throw Error('O áudio está incompleto. Importe novamente.');
      }
      objectUrl = URL.createObjectURL(blob); audio.src = objectUrl; loading = false; updatePlayer();
      if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({title:track.title,artist:'Vinicinho Doces'});
      await audio.play(); if (ticket === sequence && !importing) message('');
    } catch(e) { if (ticket === sequence) { loading = false; updatePlayer(); message(e.name === 'NotAllowedError' ? 'Áudio carregado. Toque em reproduzir para ouvir.' : errorText(e)); } }
  }
  function next(direction, ended = false) {
    const available = queue.filter(id => tracks.some(t => t.id === id && playable(t))); if (!available.length) return;
    let index = available.indexOf(current?.id) + direction;
    if (shuffle && available.length > 1) { const others = available.filter(id => id !== current?.id); return play(others[Math.floor(Math.random()*others.length)]); }
    if (ended && index >= available.length && !repeat) { updatePlayer(); return; }
    index = (index + available.length) % available.length; play(available[index]);
  }
  audio.ontimeupdate = audio.onloadedmetadata = () => {
    if (!player) return;
    const input = player.querySelector('.music-progress input'); input.max = Number.isFinite(audio.duration) ? audio.duration : 100; input.value = audio.currentTime || 0; input.disabled = !Number.isFinite(audio.duration);
    player.querySelector('.music-elapsed').textContent = time(audio.currentTime); player.querySelector('.music-duration').textContent = time(audio.duration);
  };
  audio.onplay = audio.onpause = updatePlayer;
  audio.onended = () => next(1,true);
  audio.onerror = () => { loading = false; updatePlayer(); message('Não foi possível reproduzir este formato de áudio. Tente uma versão MP3.'); };
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play',() => audio.play().catch(e => message(errorText(e))));
    navigator.mediaSession.setActionHandler('pause',() => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack',() => next(-1));
    navigator.mediaSession.setActionHandler('nexttrack',() => next(1));
  }
  window.addEventListener('beforeunload', e => { if(importing) { e.preventDefault(); e.returnValue = ''; } });
  window.VinicinhoMusic = {mount};
})();
