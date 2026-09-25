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
  let saveTimer = null;
  let lastPayload = null;

  function productGroup(name = '') {
    const value = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (value.includes('cone')) return 'Cones Trufados';
    if (value.includes('pao de mel')) return 'Pão de Mel';
    if (value.includes('bala')) return 'Bala de Ninho';
    if (value.includes('bolo de pote') || value.includes('mousse')) return 'Bolos de pote';
    return '';
  }

  async function publishCatalog(payload) {
    const products = (payload?.produtos || []).filter(product => product.tipo !== 'Ingrediente').map(product => ({
      id: String(product.id || product.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name: product.nome || 'Produto',
      group: productGroup(product.nome),
      price: +product.preco || 0,
      stock: Math.max(0, Math.floor(+product.estoque || 0)),
      emoji: product.emoji || '🍬',
      description: product.descricao || ''
    })).filter(product => product.group);
    await catalogRef.set({products, updatedAt: firebase.firestore.FieldValue.serverTimestamp()}, {merge: true});
  }

  function recordCount(data) {
    return ['vendas','produtos','despesas','clientes','fornecedores','preVendas','servicos','producoes','caixa']
      .reduce((total, key) => total + (Array.isArray(data?.[key]) ? data[key].length : 0), 0);
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

  async function initialize(localData) {
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await waitForAuthorizedUser();
    const snapshot = await dataRef.get({source: 'server'});
    if (snapshot.exists && snapshot.data()?.payload) {
      const cloudData = snapshot.data().payload;
      if (recordCount(localData) > recordCount(cloudData)) {
        await dataRef.set({payload: localData, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), owner: ALLOWED_EMAIL});
        await publishCatalog(localData);
        return localData;
      }
      await publishCatalog(cloudData);
      return cloudData;
    }
    await dataRef.set({payload: localData, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), owner: ALLOWED_EMAIL});
    await publishCatalog(localData);
    return localData;
  }

  function save(payload) {
    lastPayload = JSON.parse(JSON.stringify(payload));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await dataRef.set({payload: lastPayload, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), owner: ALLOWED_EMAIL});
        await publishCatalog(lastPayload);
        window.dispatchEvent(new CustomEvent('vinicinho-cloud-saved'));
      } catch (error) {
        console.error('Falha ao sincronizar com o Firebase:', error);
        window.dispatchEvent(new CustomEvent('vinicinho-cloud-error'));
      }
    }, 350);
  }

  async function saveNow(payload) {
    clearTimeout(saveTimer);
    lastPayload = JSON.parse(JSON.stringify(payload));
    await dataRef.set({payload: lastPayload, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), owner: ALLOWED_EMAIL});
    await publishCatalog(lastPayload);
  }

  function listenStorefrontOrders(callback) {
    return db.collectionGroup('orders').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
      callback(snapshot.docs.map(doc => ({id: doc.id, customerKey: doc.ref.parent.parent.id, ...doc.data()})));
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

  const localData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"vendas":[],"produtos":[],"despesas":[],"pagamentos":[],"clientes":[],"fornecedores":[]}');
  const ready = initialize(localData).then(data => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent('vinicinho-cloud-ready'));
    return data;
  }).catch(error => {
    console.error('Não foi possível carregar os dados do Firebase:', error);
    loginScreen(`Não foi possível carregar os dados da nuvem (${error.code || error.message || 'erro desconhecido'}).`);
    throw error;
  });

  window.VinicinhoCloud = {ready, initialize, save, saveNow, publishCatalog, listenStorefrontOrders, updateStorefrontOrder, addStorefrontMessage};
})();
