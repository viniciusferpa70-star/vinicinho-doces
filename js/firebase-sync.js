(function () {
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
  let saveTimer = null;

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
          await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider().setCustomParameters({login_hint: ALLOWED_EMAIL}));
        } catch (error) {
          button.disabled = false;
          screen.querySelector('small').textContent = 'Não foi possível entrar. Tente novamente.';
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
    const snapshot = await dataRef.get();
    if (snapshot.exists && snapshot.data()?.payload) return snapshot.data().payload;
    await dataRef.set({payload: localData, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), owner: ALLOWED_EMAIL});
    return localData;
  }

  function save(payload) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await dataRef.set({payload, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), owner: ALLOWED_EMAIL});
        window.dispatchEvent(new CustomEvent('vinicinho-cloud-saved'));
      } catch (error) {
        console.error('Falha ao sincronizar com o Firebase:', error);
        window.dispatchEvent(new CustomEvent('vinicinho-cloud-error'));
      }
    }, 350);
  }

  window.VinicinhoCloud = {initialize, save};
})();
