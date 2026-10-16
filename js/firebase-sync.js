(function () {
  if (location.hostname === 'viniciusferpa70-star.github.io') {
    const path = location.pathname.replace(/^\/vinicinho-doces\/?/, '/');
    location.replace(`https://vinicinho-doces-vf70.web.app${path}${location.search}${location.hash}`);
    return;
  }

  const ALLOWED_EMAIL = 'viniciusferpa70@gmail.com';
  const firebaseConfig = {
    apiKey: 'AIzaSyBY35RmjCQcfGc0Kj3LZll5J2jHaHooW24',
    authDomain: 'vinicinho-doces-vf70.firebaseapp.com',
    projectId: 'vinicinho-doces-vf70',
    storageBucket: 'vinicinho-doces-vf70.firebasestorage.app',
    messagingSenderId: '697137577803',
    appId: '1:697137577803:web:f748d80d4b699a6e98f2ce'
  };

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const dataRef = db.collection('businesses').doc('vinicinho-doces');
  const catalogRef = db.collection('storefront').doc('catalog');
  const STORAGE_KEY = 'vinicinho-doces-dados-limpos-v2';
  const {clone,equal,merge} = window.VinicinhoMerge;
  let baseline, latest, binding, pending = 0, stopped = false, lastError = null;
  let chain = Promise.resolve();
  let releaseListener;
  let latestRevision = 0;

  function productGroup(name = '') {
    const value = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (value.includes('cone')) return 'Cones Trufados';
    if (value.includes('pao de mel')) return 'Pão de Mel';
    if (value.includes('bala')) return 'Bala de Ninho';
    if (value.includes('bolo de pote') || value.includes('mousse')) return 'Bolos de pote';
    return '';
  }

  function productId(product = {}) {
    return String(product.id || product.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function catalogGroups(payload) {
    const configured = Array.isArray(payload?.storefrontGroups) ? payload.storefrontGroups : [];
    if (configured.length) return configured.filter(group => group.ativo !== false).sort((a,b)=>(+a.ordem||0)-(+b.ordem||0)).map((group,index) => ({
      id: String(group.id || `grupo-${index}`), name: group.nome || 'Grupo', icon: group.emoji || '🍬', image: group.imagem || '', order: index,
      productIds: Array.isArray(group.productIds) ? group.productIds.map(String) : []
    }));
    return [
      {id:'cones-trufados',name:'Cones Trufados',icon:'🍦',image:'',order:0,productIds:[]},
      {id:'pao-de-mel',name:'Pão de Mel',icon:'🍯',image:'',order:1,productIds:[]},
      {id:'bala-de-ninho',name:'Bala de Ninho',icon:'🍬',image:'',order:2,productIds:[]},
      {id:'bolos-de-pote',name:'Bolos de pote',icon:'🍰',image:'',order:3,productIds:[]}
    ];
  }

  function catalogPayload(payload) {
    const groups = catalogGroups(payload), configured=Array.isArray(payload?.storefrontGroups)&&payload.storefrontGroups.length>0;
    const products = (payload?.produtos || []).filter(product => product.tipo !== 'Ingrediente').map(product => {
      const id=productId(product),group=configured?groups.find(entry=>entry.productIds.includes(id)):groups.find(entry=>entry.name===productGroup(product.nome));
      return {
      id,
      name: product.nome || 'Produto',
      groupId: group?.id || '',
      group: group?.name || '',
      price: +product.preco || 0,
      stock: Math.max(0, Math.floor(+product.estoque || 0)),
      emoji: product.emoji || '🍬',
      description: product.descricao || ''
    }}).filter(product => product.groupId);
    return {groups:groups.map(({productIds,...group})=>group),products, updatedAt: firebase.firestore.FieldValue.serverTimestamp()};
  }


  function loginScreen(message = '') {
    let screen = document.getElementById('firebaseLoginScreen');
    if (!screen) {
      screen = document.createElement('div');
      screen.id = 'firebaseLoginScreen';
      screen.innerHTML = `<section><img src="assets/logo-vinicinho-sem-fundo.png" alt="Vinicinho Doces"><h1>Vinicinho Doces</h1><p>Entre com a conta autorizada para acessar seus dados em qualquer dispositivo.</p><button type="button">Entrar com Google</button><small></small></section>`;
      document.body.appendChild(screen);
      screen.querySelector('button').onclick = async () => {
        const button = screen.querySelector('button');
        button.disabled = true;
        screen.querySelector('small').textContent = 'Abrindo o Google…';
        try {
          await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider().setCustomParameters({login_hint: ALLOWED_EMAIL}));
        } catch (error) {
          button.disabled = false;
          const messages = {
            'auth/popup-blocked': 'O Chrome bloqueou a janela do Google. Permita pop-ups para este site e tente novamente.',
            'auth/popup-closed-by-user': 'A janela de login foi fechada antes da conclusão.',
            'auth/unauthorized-domain': 'Este endereço ainda não está autorizado no Firebase.'
          };
          screen.querySelector('small').textContent = messages[error.code] || `Não foi possível entrar (${error.code || 'erro desconhecido'}).`;
        }
      };
    }
    screen.querySelector('small').textContent = message;
    return screen;
  }

  function waitForAuthorizedUser() {
    return new Promise((resolve) => {
      const unsubscribe = auth.onAuthStateChanged(async user => {
        if (!user) {
          loginScreen();
          return;
        }
        if ((user.email || '').toLowerCase() !== ALLOWED_EMAIL) {
          await auth.signOut();
          loginScreen(`A conta ${user.email || ''} não está autorizada.`);
          return;
        }
        unsubscribe();
        document.getElementById('firebaseLoginScreen')?.remove();
        resolve(user);
      });
    });
  }

  function report(state, message = '') {
    const node = document.getElementById('cloudSyncStatus');
    if (node) {
      node.hidden = state === 'synced' && !message;
      node.dataset.state = state;
      node.querySelector('span').textContent = message;
      node.querySelector('button').hidden = state !== 'error';
    }
    window.dispatchEvent(new CustomEvent('vinicinho-cloud-status', {detail:{state,message}}));
  }

  function deliver() {
    if (!binding || pending || stopped || !latest) return;
    if (equal(baseline,latest)) return;
    if (binding.busy()) {
      report('waiting','Atualizações recebidas de outro computador. Conclua ou feche a edição para atualizar a tela.');
      return;
    }
    try {
      const data = merge(baseline,binding.read(),latest);
      baseline = clone(latest);
      binding.apply(data);
      report('synced');
    } catch(error) {
      stopped = true; lastError = error;
      report('error',error.message);
    }
  }

  async function initialize() {
    // Only authentication persists. Business records never use browser storage.
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await waitForAuthorizedUser();
    const snapshot = await dataRef.get({source:'server'});
    if (!snapshot.exists || !snapshot.data()?.payload) throw Error('O banco de dados não está disponível. Nenhuma cópia local será enviada.');
    baseline = clone(snapshot.data().payload);
    latest = clone(baseline);
    latestRevision = snapshot.data().revision || 0;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    releaseListener = dataRef.onSnapshot({includeMetadataChanges:true}, snapshot => {
      if (snapshot.metadata.hasPendingWrites) return;
      if (snapshot.metadata.fromCache) {
        report('offline','Sem confirmação do Firebase. Verifique a conexão antes de salvar.');
        return;
      }
      if (!snapshot.exists || !snapshot.data()?.payload) {
        stopped = true; lastError = Error('Os dados não estão disponíveis no Firebase.');
        report('error',lastError.message); return;
      }
      const revision = snapshot.data().revision || 0;
      if (revision < latestRevision) return;
      latestRevision = revision;
      latest = clone(snapshot.data().payload);
      deliver();
      if (!pending && !stopped && equal(baseline,latest)) report('synced');
    }, error => { stopped = true; lastError = error; report('error','Não foi possível acompanhar o Firebase. Atualize os dados antes de continuar.'); });
    return clone(baseline);
  }

  function saveNow(payload) {
    if (stopped) return Promise.reject(lastError || Error('Atualize os dados do Firebase antes de salvar.'));
    const before = clone(baseline), target = clone(payload);
    baseline = clone(target);
    pending++;
    report('saving','Salvando no Firebase… Não feche esta página.');
    const job = chain.then(async () => {
      if (stopped) throw lastError;
      if (!navigator.onLine) throw Error('Sem conexão. A alteração não foi salva no Firebase.');
      const committed = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(dataRef);
        if (!snapshot.exists || !snapshot.data()?.payload) throw Error('Os dados não estão disponíveis no Firebase.');
        const document = snapshot.data();
        const merged = merge(before,target,document.payload);
        const revision = (document.revision || 0) + 1;
        transaction.set(dataRef, {payload:merged,revision,syncVersion:2,owner:ALLOWED_EMAIL,updatedAt:firebase.firestore.FieldValue.serverTimestamp()}, {merge:true});
        transaction.set(catalogRef, {...catalogPayload(merged),revision,syncVersion:2}, {merge:true});
        return {payload:merged,revision};
      });
      if (committed.revision >= latestRevision) { latestRevision = committed.revision; latest = clone(committed.payload); }
      window.dispatchEvent(new CustomEvent('vinicinho-cloud-saved'));
      return clone(committed.payload);
    }).catch(error => {
      stopped = true; lastError = error;
      report('error', error.code === 'sync/conflict' ? error.message : 'Não foi possível salvar no Firebase. A alteração está somente nesta tela. Verifique a conexão; copie o que precisa antes de recarregar os dados.');
      window.dispatchEvent(new CustomEvent('vinicinho-cloud-error', {detail:error}));
      throw error;
    }).finally(() => {
      pending--;
      if (!pending && !stopped) { report('synced'); deliver(); }
    });
    chain = job.catch(() => {});
    return job;
  }

  function save(payload) { return saveNow(payload); }
  async function reload() {
    if (pending) return;
    const snapshot = await dataRef.get({source:'server'});
    if (!snapshot.exists || !snapshot.data()?.payload) throw Error('Os dados não estão disponíveis no Firebase.');
    latest = clone(snapshot.data().payload); baseline = clone(latest);
    latestRevision = snapshot.data().revision || 0;
    stopped = false; lastError = null;
    binding?.apply(clone(latest),true);
    report('synced');
  }
  function bind(value) { binding = value; deliver(); }
  window.addEventListener('beforeunload', event => {
    if (pending || stopped) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('offline', () => report('offline','Sem conexão. Os dados não serão salvos até reconectar ao Firebase.'));
  setInterval(deliver,1000);

  function listenStorefrontOrders(callback) {
    return db.collectionGroup('orders').onSnapshot(snapshot => {
      const orders=snapshot.docs.map(doc => ({id: doc.id, customerKey: doc.ref.parent.parent.id, ...doc.data()}));
      orders.sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
      callback(orders);
    }, error => console.error('Falha ao acompanhar pedidos da loja:', error));
  }

  function updateStorefrontOrder(order, changes) {
    return db.collection('storefrontCustomers').doc(order.customerKey).collection('orders').doc(order.id).update({
      ...changes,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  function addStorefrontMessage(order, text) {
    return updateStorefrontOrder(order, {
      messages: firebase.firestore.FieldValue.arrayUnion({sender:'admin', text, createdAt:new Date().toISOString()}),
      customerUnread: true,
      adminUnread: false
    });
  }

  const ready = initialize().catch(error => {
    console.error('Não foi possível carregar os dados do Firebase:', error);
    loginScreen(`Não foi possível carregar os dados da nuvem (${error.code || error.message}). Verifique a conexão e recarregue a página.`);
    throw error;
  });
  window.VinicinhoCloud = {ready,save,saveNow,bind,reload,listenStorefrontOrders,updateStorefrontOrder,addStorefrontMessage,get pending(){return pending>0;},get blocked(){return stopped;}};
})();
