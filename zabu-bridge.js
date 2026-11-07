/*!
 * Zabu Crazy Fruit — Native köprüsü (Flutter WebView ⇄ Cocos oyunu)
 *
 * Güvenlik:
 *  - Bu sayfa HİÇBİR token / gizli anahtar tutmaz. Bahisleri Flutter kendi
 *    oturumuyla sunucuya gönderir; sonuçları sunucu belirler.
 *  - Oyundan Flutter'a sadece izin verilen action'lar iletilir.
 *  - Rapor/kayıt istekleri aynı origin'e yönlenir ve köprüde yakalanır (dışarı çıkmaz).
 *
 * Akış:
 *  Flutter → window.__zabuInit(user)       : kullanıcı bilgisini verir, oyunu başlatır
 *  Flutter → window.__zabuEmit(event, p)   : RTM olayı (crazy_fruit_init/state/bet/diamond_sync)
 *  Flutter → window.__zabuVisibility(bool) : popup görünür/gizli (ses + render durur)
 *  Oyun    → ZabuBridge.postMessage(json)  : {type:'rtm'|'close'|'recharge'|'loaded'|'displayed'|'records'}
 *  Flutter → window.__zabuRecords(id, res) : oyun kayıtları cevabı
 */
(function () {
  'use strict';

  var GAME_ID = 29;
  var ALLOWED_ACTIONS = ['CrazyFruit:init', 'CrazyFruit:join', 'CrazyFruit:bet', 'CrazyFruit:charge'];

  var user = null;
  var booted = false;
  var bootQueue = [];

  function post(msg) {
    try {
      if (window.ZabuBridge && typeof window.ZabuBridge.postMessage === 'function') {
        window.ZabuBridge.postMessage(JSON.stringify(msg));
      }
    } catch (e) { /* yok say */ }
  }

  function userJson() {
    if (!user) return '{}';
    return JSON.stringify({
      userId: user.userId,
      funId: user.userId,
      userName: user.name,
      nickName: user.name,
      avatar: user.avatar || '',
      token: 'zabu',            // gerçek token DEĞİL; oyun sadece boş olmamasını bekliyor
      coin: user.coin || 0,
      gold: user.coin || 0,
      roomId: String(user.roomId || ''),
      uiLang: user.lang || 'tr',
      appVersion: '1.0.0',
      packageName: 'com.zabuchat.app'
    });
  }

  function safeStorageGet(k) {
    try { return window.localStorage.getItem('zabu_' + k) || ''; } catch (e) { return ''; }
  }
  function safeStorageSet(raw) {
    try {
      var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (o && o.key) window.localStorage.setItem('zabu_' + o.key, String(o.value == null ? '' : o.value));
    } catch (e) { /* yok say */ }
  }

  var noop = function () { return ''; };
  var close = function () { post({ type: 'close' }); return ''; };
  var recharge = function () { post({ type: 'recharge' }); return ''; };

  // Oyunun SDK'sı senkron cevapları {"params": "<json>"} zarfında bekler
  // (zarfsız gelirse kullanıcı bilgisini undefined görüp açılışta takılıyor).
  // Bu oyunun SDK'sı zarfı BASE64 olarak bekliyor (düz JSON → kullanıcı bilgisi boş, dil yanlış)
  function wrap(v) {
    var json = JSON.stringify({ params: typeof v === 'string' ? v : JSON.stringify(v) });
    try { return btoa(unescape(encodeURIComponent(json))); } catch (e) { return json; }
  }
  function wrapped(fn) { return function (p) { return wrap(fn(p)); }; }

  var api = {
    getUserInfo: userJson,
    getUserInfoNew: userJson,
    GetUserInfo: userJson,
    getUserCoin: function () { return user ? user.coin : 0; },
    getRoomId: function () { return user ? String(user.roomId || '') : ''; },
    getToken: function () { return 'zabu'; },
    getFunId: function () { return user ? user.userId : ''; },
    getAppVersionCode: function () { return '10000'; },
    isNativeAsset: function () { return false; },
    getAppPerformance: function () { return JSON.stringify({ memory: (user && user.memory) || 4096 }); },
    getDeviceMemory: function () { return (user && user.memory) || 4096; },
    // Kayıt/rapor istekleri aynı origin'e gider, köprü yakalar (eski firmaya hiçbir şey gitmez)
    getAppRequestHost: function () { return { live: location.origin, report: location.origin }; },
    getAppRequestHostNew: function () { return { live: location.origin, report: location.origin }; },
    getMicAndSoundState: function () { return JSON.stringify({ mic: false, sound: true }); },
    getWebLocalData: safeStorageGet,
    setNewWebLocalData: function (raw) { safeStorageSet(raw); return ''; },
    closePage: close,
    closePageNew: close,
    closeLoadingPage: function () { post({ type: 'loaded' }); return ''; },
    closeLoadingPageNew: function () { post({ type: 'loaded' }); return ''; },
    event_h5game_displayed: function () { post({ type: 'displayed' }); return ''; },
    event_webview_success: function () { post({ type: 'loaded' }); return ''; },
    popUpBottomRecharge: recharge,
    showRechargeDialog: recharge,
    requestMsg: function (raw) {
      var req = raw;
      if (typeof raw === 'string') {
        try { req = JSON.parse(raw); } catch (e) { return ''; }
      }
      if (!req || typeof req.action !== 'string') return '';
      if (ALLOWED_ACTIONS.indexOf(req.action) < 0) return '';
      if (req.action === 'CrazyFruit:charge') { recharge(); return ''; }
      post({ type: 'rtm', action: req.action, params: req.params || {} });
      return '';
    },
    h5ToNative: function (raw) {
      try {
        var o = JSON.parse(raw);
        if (!o) return '';
        if (o.actionName === 'closePage') close();
        else if (o.actionName === 'event_h5game_displayed') post({ type: 'displayed' });
        else if (o.actionName === 'popUpBottomRecharge' || o.actionName === 'showRechargeDialog') recharge();
      } catch (e) { /* yok say */ }
      return '';
    }
  };

  // Değer döndüren getter'ları zarfla (eylem metotları hariç)
  ['getUserInfo', 'getUserInfoNew', 'GetUserInfo', 'getUserCoin', 'getRoomId', 'getToken', 'getFunId',
   'getAppVersionCode', 'isNativeAsset', 'getAppPerformance', 'getDeviceMemory', 'getMicAndSoundState',
   'getWebLocalData', 'getAppRequestHost', 'getAppRequestHostNew'].forEach(function (k) { api[k] = wrapped(api[k]); });

  // Oyunun çağırabileceği bilinmeyen metotlar hata fırlatmasın
  window.fun = typeof Proxy === 'function'
    ? new Proxy(api, { get: function (t, k) { return k in t ? t[k] : noop; } })
    : api;

  // iOS / Android dışı yol: oyunun HTML'i getter'ları window.prompt(method) ile çağırıyor.
  // Sadece bilinen metotlar cevaplanır; gerçek bir prompt diyaloğu asla açılmaz.
  window.prompt = function (method, param) {
    if (typeof method !== 'string') return null;
    if (method === 'h5ToNative') return api.h5ToNative(param);
    if (Object.prototype.hasOwnProperty.call(api, method)) {
      try { return api[method](param); } catch (e) { return null; }
    }
    return null;
  };

  // ── Flutter → Oyun ────────────────────────────────────────────────────
  window.__zabuEmit = function (event, params) {
    if (typeof window.RTMResponseMsg !== 'function') return;
    try {
      window.RTMResponseMsg(JSON.stringify({ gameId: GAME_ID, events: [{ event: event, params: params || {} }] }));
    } catch (e) { /* yok say */ }
  };

  window.__zabuSetCoin = function (coin) {
    if (user) user.coin = coin;
  };

  window.__zabuVisibility = function (visible) {
    try {
      var cc = window.cc;
      if (!cc || !cc.game) return;
      if (visible) {
        if (cc.game.isPaused && cc.game.isPaused()) cc.game.resume();
        if (cc.Game && cc.Game.EVENT_SHOW) cc.game.emit(cc.Game.EVENT_SHOW);
      } else {
        if (cc.Game && cc.Game.EVENT_HIDE) cc.game.emit(cc.Game.EVENT_HIDE);
        cc.game.pause();
      }
    } catch (e) { /* yok say */ }
  };

  // ── Oyun içi HTTP istekleri (kayıtlar / sıralama / profil) ──────────────
  // Oyun bunları eski sağlayıcının sunucusuna XHR ile atıyordu → sonsuz
  // "yükleniyor". Burada yakalanır: kayıtlar Flutter'dan (kendi oturumuyla)
  // gelir, diğerleri ağa hiç çıkmadan boş cevaplanır.
  var HTTP_RE = /\/game\/crazy-fruit\/|\/game\/operation\/|\/v2\/client-event\/report/;
  var httpSeq = 0;
  var httpPending = {};

  function fakeRespond(xhr, obj) {
    try {
      var body = xhr.responseType === 'json' ? obj : JSON.stringify(obj);
      Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
      Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
      Object.defineProperty(xhr, 'response', { value: body, configurable: true });
      if (xhr.responseType !== 'json') {
        Object.defineProperty(xhr, 'responseText', { value: body, configurable: true });
      }
    } catch (e) { /* yok say */ }
    setTimeout(function () {
      try { if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange(); } catch (e) { /* */ }
      try { if (typeof xhr.onload === 'function') xhr.onload(); } catch (e) { /* */ }
    }, 0);
  }

  // Tur no: sunucudaki mutlak no (epoch/40) yerine günün kaçıncı turu
  // (İstanbul saatiyle 00:00'da 1'den başlar; günde 2160 tur)
  function dailyRound(id) {
    var n = Number(id);
    if (!isFinite(n)) return id;
    return Math.floor(((n * 40 + 10800) % 86400) / 40) + 1;
  }

  function mapRecords(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var betMap = {};
      var bets = r.bets || [];
      for (var j = 0; j < bets.length; j++) {
        var b = bets[j] || {};
        var k = String(b.food_id);
        betMap[k] = (betMap[k] || 0) + (Number(b.amount) || 0);
      }
      out.push({
        roundId: dailyRound(r.round_id),
        settleTime: Date.parse(r.time) || Date.now(),
        foodId: r.result_food,
        win: Number(r.win) || 0,
        bet: Number(r.bet) || 0,
        betMap: betMap
      });
    }
    return out;
  }

  function handleFakeHttp(xhr, url) {
    var q = {};
    try { new URL(url, location.href).searchParams.forEach(function (v, k) { q[k] = v; }); } catch (e) { /* */ }
    if (url.indexOf('/bet-recored') < 0 || !window.ZabuBridge) {
      fakeRespond(xhr, url.indexOf('/v2/client-event/report') >= 0 ? { code: 200 } : { code: 404, message: 'disabled' });
      return;
    }
    var page = Math.max(0, parseInt(q.page, 10) || 0);
    var size = Math.min(Math.max(parseInt(q.size, 10) || 10, 1), 20);
    var id = ++httpSeq;
    httpPending[id] = { xhr: xhr, page: page, size: size };
    // Flutter cevap vermezse oyun 2 sn sonra kendisi tekrar dener
    httpPending[id].timer = setTimeout(function () {
      if (httpPending[id]) { delete httpPending[id]; fakeRespond(xhr, { code: 500, message: 'timeout' }); }
    }, 10000);
    post({ type: 'records', id: id, offset: page * size, limit: size + 1 });
  }

  // Flutter → kayıt cevabı: res = {ok, records:[...]}
  window.__zabuRecords = function (id, res) {
    var p = httpPending[id];
    if (!p) return;
    delete httpPending[id];
    clearTimeout(p.timer);
    if (!res || res.ok !== true) { fakeRespond(p.xhr, { code: 500, message: 'error' }); return; }
    var list = res.records || [];
    fakeRespond(p.xhr, {
      code: 200,
      data: { page: p.page, more: list.length > p.size, records: mapRecords(list.slice(0, p.size)) }
    });
  };

  var xOpen = XMLHttpRequest.prototype.open;
  var xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__zabuUrl = (typeof url === 'string' && HTTP_RE.test(url)) ? url : null;
    return xOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__zabuUrl) { handleFakeHttp(this, this.__zabuUrl); return; }
    return xSend.apply(this, arguments);
  };

  // ── Oyun yamaları (önbellekteki paket dosyalarına dokunmadan) ──────────
  // 1) Parmak: oyun her init'te parmak sayacını sıfırlıyor ama görünen parmağı
  //    gizlemiyordu → kapat/aç sonrası 2-3 parmak. Sıfırlamada 8'ini de gizle.
  // 2) Avatar: yuvarlak avatar materyali, resim sonradan yüklenince çizmiyordu
  //    (kazanan popup'ında isim var avatar yok). Yüklemeden sonra materyali
  //    yeniden ata.
  var patched = { finger: false, avatar: false, record: false, lang: false, rank: false, coinBtn: false, chest: false, fingerNow: false };
  function tryPatch() {
    var cc = window.cc;
    if (!cc || !cc.js || typeof cc.js.getClassByName !== 'function') return false;

    // Parmak: Crazy Fruit'in kendi mantığı doğru (Greedy yaması el imlecini gizlemiyordu).
    // Oyun parmağı ancak ilk saniye tikinde gösteriyordu → yeni tur / yeniden açılışta
    // 1-2 sn geç geliyordu. Bahis aşaması başlar başlamaz hemen göster.
    if (!window.__zabuGameData && window.System && typeof window.System.has === 'function' &&
        window.System.has('chunks:///_virtual/GameModel.ts')) {
      window.__zabuGameData = function () { return null; };
      window.System.import('chunks:///_virtual/GameModel.ts').then(function (m) {
        window.__zabuGameData = function () { return (m && m.gameModel && m.gameModel.gameData) || null; };
      }).catch(function () { window.__zabuGameData = null; });
    }
    if (!patched.fingerNow) {
      var GMF = cc.js.getClassByName('GameMain');
      if (GMF && GMF.prototype && typeof GMF.prototype.updateGameState === 'function' &&
          typeof GMF.prototype.updateItemFingerState === 'function') {
        var showNow = function (self) {
          try {
            var gd = self && self._contentTop && window.__zabuGameData && window.__zabuGameData();
            if (gd && gd.state === 1 && gd.countDown > 0) {
              var idx = self._curFingerIndex >= 0 ? self._curFingerIndex : 0;
              self.updateItemFingerState(idx % 8);
            }
          } catch (e) { /* */ }
        };
        var oState = GMF.prototype.updateGameState;
        GMF.prototype.updateGameState = function (t) {
          var r = oState.apply(this, arguments);
          if (t && t.state === 1) showNow(this);
          return r;
        };
        if (typeof GMF.prototype.gameInitDataRsp === 'function') {
          var oInit = GMF.prototype.gameInitDataRsp;
          GMF.prototype.gameInitDataRsp = function () {
            var r = oInit.apply(this, arguments);
            showNow(this);
            return r;
          };
        }
        patched.fingerNow = true;
      }
    }
    patched.finger = true;
    if (!patched.finger) {
      var GM = cc.js.getClassByName('GameMain');
      if (GM && GM.prototype && typeof GM.prototype.updateItemFingerState === 'function') {
        var origFinger = GM.prototype.updateItemFingerState;
        GM.prototype.updateItemFingerState = function (t) {
          if (t < 0 || this._lastFingerIndex < 0) {
            try {
              var kids = (this._contentTop && this._contentTop.children) || [];
              for (var i = 0; i < kids.length && i < 8; i++) {
                var f = kids[i] && kids[i].getChildByName('finger');
                if (f) f.active = false;
              }
            } catch (e) { /* */ }
            if (t < 0) { this._lastFingerIndex = t; return; }
            this._lastFingerIndex = -1;
          }
          return origFinger.call(this, t);
        };
        patched.finger = true;
      }
    }

    if (!patched.avatar) {
      var SA = cc.js.getClassByName('SpriteAdapter');
      if (SA && SA.prototype && typeof SA.prototype.setSpiteFrame === 'function') {
        var origSet = SA.prototype.setSpiteFrame;
        SA.prototype.setSpiteFrame = function (frame) {
          var r = origSet.apply(this, arguments);
          try {
            var sp = this.sprite;
            if (sp && frame) {
              var mat = this.__zabuMat || sp.customMaterial;
              if (mat) {
                this.__zabuMat = mat;
                if (String(this._url || '').indexOf('data:') === 0) {
                  // Flutter'dan gelen hazır yuvarlak avatar: shader'a gerek yok
                  sp.customMaterial = null;
                } else {
                  sp.customMaterial = null; sp.customMaterial = mat;
                }
              }
            }
          } catch (e) { /* */ }
          return r;
        };
        patched.avatar = true;
      }
    }
    // 3) Kayıt satırı: "Altın Bakiyesi" verisi yok → boş "->" yerine satırı gizle
    if (!patched.record) {
      var RI = cc.js.getClassByName('RecordItem');
      if (RI && RI.prototype && typeof RI.prototype.updateView === 'function') {
        var origView = RI.prototype.updateView;
        RI.prototype.updateView = function (t) {
          var r = origView.apply(this, arguments);
          try {
            if (t && typeof t.assetNum !== 'number' && this._foodLayout && this._foodLayout.node) {
              var row = this._foodLayout.node.getChildByName('item_last_coin');
              if (row && row.active) { row.active = false; this._foodLayout.updateLayout(true); }
            }
          } catch (e) { /* */ }
          return r;
        };
        patched.record = true;
      }
    }

    // 4) Türkçe çeviri düzeltmeleri ("Round" → "Yuvarlak" vb.)
    if (!patched.lang) {
      var langs = window.languages;
      if (langs) {
        for (var key in langs) {
          var L = langs[key];
          if (L && L.Round === 'Yuvarlak') {
            L.Round = 'Tur';
            L.Bet = 'Bahis';
            L['Win coins'] = 'Kazanılan';
            L['Winning friuts'] = 'Kazanan meyve';
            L.record_tips_1 = 'Son 7 günün en fazla 200 oyun kaydı gösterilir.';
            L.record_tips_2 = 'Son 7 günün en fazla 200 oyun kaydı gösterilir.';
            L.today_win = 'Bugünkü kazanç';
            L.rule_2 = 'Her turda meyve seçmek için 30 saniyeniz var, ardından kazanan meyve çekilir.';
            patched.lang = true;
          }
        }
      }
    }
    // 5) Kupa (sıralama) butonu: bizde sıralama yok → gizle
    if (!patched.rank) {
      var RB = cc.js.getClassByName('GameRankBtn');
      if (RB && RB.prototype) {
        // Orijinal onLoad çalışsın (alanlar dolsun) → sonra gizle. onLoad'ı tamamen
        // ezmek alanları null bırakıyordu → oyun her karede hata verip takılıyordu.
        if (!RB.prototype.__zabuWrapped) {
          RB.prototype.__zabuWrapped = true;
          var oLoad = RB.prototype.onLoad;
          RB.prototype.onLoad = function () {
            try { if (oLoad) oLoad.apply(this, arguments); } catch (e) { /* */ }
            try { this.node.active = false; } catch (e) { /* */ }
          };
          Object.getOwnPropertyNames(RB.prototype).forEach(function (k) {
            if (k === 'onLoad' || k === 'constructor' || k === '__zabuWrapped') return;
            var d = Object.getOwnPropertyDescriptor(RB.prototype, k);
            var f = d && d.value;
            if (typeof f !== 'function') return;
            RB.prototype[k] = function () { try { return f.apply(this, arguments); } catch (e) { return undefined; } };
          });
        }
        try {
          var walk = function (n) {
            (n.components || []).forEach(function (c) { if (c instanceof RB) { c.node.active = false; patched.rank = true; } });
            (n.children || []).forEach(walk);
          };
          var sc = cc.director && cc.director.getScene && cc.director.getScene();
          if (sc) walk(sc);
        } catch (e) { /* */ }
      }
    }
    // 5b) "i" (oyun parası açıklaması) butonu: bizde oyun parası yok → gizle
    if (!patched.coinBtn) {
      var CB = cc.js.getClassByName('CoinBtnView');
      if (CB && CB.prototype) {
        if (!CB.prototype.__zabuWrapped) {
          CB.prototype.__zabuWrapped = true;
          var cbLoad = CB.prototype.onLoad;
          CB.prototype.onLoad = function () {
            try { if (cbLoad) cbLoad.apply(this, arguments); } catch (e) { /* */ }
            try { this.node.active = false; } catch (e) { /* */ }
          };
          Object.getOwnPropertyNames(CB.prototype).forEach(function (k) {
            if (k === 'onLoad' || k === 'constructor' || k === '__zabuWrapped') return;
            var d = Object.getOwnPropertyDescriptor(CB.prototype, k);
            var f = d && d.value;
            if (typeof f !== 'function') return;
            CB.prototype[k] = function () { try { return f.apply(this, arguments); } catch (e) { return undefined; } };
          });
        }
        try {
          var sc3 = cc.director && cc.director.getScene && cc.director.getScene();
          var walk3 = function (n) {
            (n.components || []).forEach(function (c) { if (c instanceof CB) { c.node.active = false; patched.coinBtn = true; } });
            (n.children || []).forEach(walk3);
          };
          if (sc3) walk3(sc3);
        } catch (e) { /* */ }
      }
    }
    // 6) Sandık/etkinlik paneli (entrance_layout): bizde yok → gizle; sonuç satırı onun yerine (Greedy gibi)
    if (!patched.chest) {
      try {
        var GM2 = cc.js.getClassByName('GameMain');
        var scn = cc.director && cc.director.getScene && cc.director.getScene();
        var main = null;
        var walk2 = function (n) {
          if (main) return;
          (n.components || []).forEach(function (c) { if (!main && GM2 && c instanceof GM2) main = c; });
          (n.children || []).forEach(walk2);
        };
        if (scn) walk2(scn);
        var ct = main && main._content;
        var ent = ct && ct.getChildByName('entrance_layout');
        var rl = ct && ct.getChildByName('result_layout');
        var rt = ct && ct.getChildByName('result_title_label');
        if (ent && rl) {
          var dy = ent.position.y - rl.position.y;
          ent.active = false;
          var dots = ct.getChildByName('dot_layout');
          if (dots) dots.active = false;
          [rl, rt].forEach(function (n) {
            if (!n) return;
            var w = n.getComponent(cc.Widget);
            if (w) w.enabled = false; // hizalama her karede alta çekiyordu
            n.setPosition(n.position.x, n.position.y + dy, n.position.z);
          });
          patched.chest = true;
        }
      } catch (e) { /* */ }
    }
    return patched.finger && patched.avatar && patched.record && patched.lang && patched.rank && patched.coinBtn && patched.chest && patched.fingerNow;
  }
  // ── Ekran uyumu ────────────────────────────────────────────────────────
  // Tasarım 750×1334 ve FIXED_WIDTH: alan bu orandan kısaysa (kısa telefon,
  // tablet) üst bar kesiliyordu. Kısa alanda SHOW_ALL → oyunun tamamı görünür,
  // yanlar şeffaf kalır. Uzun alanda FIXED_WIDTH (tam genişlik) kalır.
  var lastPolicy = null;
  function fitScreen() {
    var cc = window.cc;
    if (!cc || !cc.view || !cc.ResolutionPolicy || !cc.game || !cc.game.inited) return false;
    var w = window.innerWidth || 1, h = window.innerHeight || 1;
    // Uzun alan: NO_BORDER → oyun alanı tamamen kaplar (üstte ince boş/siyah
    // şerit kalmaz; fark birkaç piksel, yanlardan kırpılır). Kısa alan: SHOW_ALL.
    var tall = h / w >= (1334 / 750) - 0.02;
    var pol = tall ? cc.ResolutionPolicy.FIXED_WIDTH : cc.ResolutionPolicy.SHOW_ALL;
    if (pol !== lastPolicy) {
      try { cc.view.setDesignResolutionSize(750, 1334, pol); lastPolicy = pol; } catch (e) { /* */ }
    }
    return true;
  }
  var fitTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitScreen, 120);
  });

  var langDone = false;
  var langBusy = false;
  function tryLang() {
    if (langDone || langBusy || !window.System || typeof window.System.has !== 'function') return langDone;
    if (!window.System.has('chunks:///_virtual/GameInit.ts')) return false;
    langBusy = true;
    Promise.all([
      window.System.import('chunks:///_virtual/GameInit.ts'),
      window.System.import('chunks:///_virtual/LanguageData.ts')
    ]).then(function (mods) {
      try {
        if (mods[0] && typeof mods[0].initLang === 'function') mods[0].initLang();
        var LD = mods[1] && mods[1].LanguageData;
        if (LD && LD.instance && typeof LD.instance.updateSceneRenderers === 'function') LD.instance.updateSceneRenderers();
      } catch (e) { /* */ }
      langDone = true;
    }).catch(function () { langBusy = false; });
    return false;
  }

  var patchTries = 0;
  var patchTimer = setInterval(function () {
    var fitted = lastPolicy !== null || fitScreen();
    var lang = tryLang();
    if ((tryPatch() && fitted && lang) || ++patchTries > 600) clearInterval(patchTimer); // en fazla ~2 dk
  }, 200);

  // ── Boot kilidi: kullanıcı bilgisi gelmeden Cocos yüklenmez ─────────────
  window.__zabuBoot = function (fn) {
    if (booted) { fn(); } else { bootQueue.push(fn); }
  };

  window.__zabuInit = function (u) {
    if (!u || !u.userId) return;
    user = u;
    if (booted) return;
    booted = true;
    var q = bootQueue.splice(0);
    for (var i = 0; i < q.length; i++) { try { q[i](); } catch (e) { console.error(e); } }
  };

  // Tarayıcıda tek başına açılırsa (Flutter yok) bilgi ver
  setTimeout(function () {
    if (!booted && !window.ZabuBridge) {
      document.body && (document.body.style.background = '#111');
      console.warn('[ZabuBridge] Flutter köprüsü yok — oyun yalnızca Zabu uygulaması içinde çalışır.');
    }
  }, 3000);
})();
