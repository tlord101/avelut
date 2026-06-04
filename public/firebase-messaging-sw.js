// Import and configure the Firebase SDK (Compat v9)
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyA2oJ1vB5TDQWr2-Gz72jpCl7pX8rmKmE8",
  authDomain: "tlord-1ab38.firebaseapp.com",
  databaseURL: "https://tlord-1ab38-default-rtdb.firebaseio.com",
  projectId: "tlord-1ab38",
  storageBucket: "tlord-1ab38.firebasestorage.app",
  messagingSenderId: "750743868519",
  appId: "1:750743868519:web:423b7ba5e2a3d73b6570c2",
  measurementId: "G-RH14Z1F6T9"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title || 'VANTUTOR';
  const notificationOptions = {
    body: payload.notification.body,
    icon: payload.notification.icon || 'https://ai.vaultsglofin.com/logo.svg',
    badge: payload.notification.badge || 'https://ai.vaultsglofin.com/logo_white.svg',
    data: payload.data || {}
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
