/* ════════════════════════════════════════════════════════════════════════
   KAPAK UZUN SÜRE AÇIK UYARI MODÜLÜ — kapak-uyari.js
   ════════════════════════════════════════════════════════════════════════
   KURULUM: Bu dosyayı sitenizdeki diğer .js dosyalarınızla (auth.js,
   doluluk-veri.js vb.) aynı klasöre koyun, sonra her hedef sayfada
   </body> etiketinden hemen önce şu tek satırı ekleyin:

     <script src="kapak-uyari.js"></script>

   Başka hiçbir değişiklik gerekmez — bu dosya kendi CSS'ini ve modal
   HTML'ini sayfaya otomatik olarak enjekte eder.

   Nasıl çalışır: localStorage'daki 'kapakDurumu' ve 'kapakAcilmaZamanlari'
   anahtarlarını okur (makine.html bunları zaten yazıyor). Bu yüzden hiçbir
   sayfaya özel state'e ihtiyaç duymaz.
   ════════════════════════════════════════════════════════════════════════ */
(function () {

  // ── 1) CSS'i enjekte et ─────────────────────────────────────────────────
  var stil = document.createElement('style');
  stil.textContent = [
    '.kapak-uyari-overlay{position:fixed;inset:0;background:rgba(20,21,23,0.6);',
    'backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;',
    'padding:20px;z-index:1000;opacity:0;pointer-events:none;transition:opacity .2s ease;}',
    '.kapak-uyari-overlay.show{opacity:1;pointer-events:auto;}',
    '.kapak-uyari-banner{display:flex;gap:14px;align-items:flex-start;width:100%;',
    'max-width:440px;padding:26px 24px 22px;border-radius:14px;background:var(--paper);',
    'border-top:4px solid #C0392B;box-shadow:0 20px 60px rgba(0,0,0,0.35);',
    'transform:translateY(10px) scale(0.97);transition:transform .2s ease;}',
    '.kapak-uyari-overlay.show .kapak-uyari-banner{transform:translateY(0) scale(1);}',
    '.kapak-uyari-ikon{width:40px;height:40px;border-radius:10px;background:#FCEAEA;',
    'color:#C0392B;display:flex;align-items:center;justify-content:center;flex-shrink:0;',
    'animation:kapakUyariNabiz 1.8s ease-in-out infinite;}',
    '.kapak-uyari-ikon svg{width:20px;height:20px;}',
    '.kapak-uyari-govde{flex:1;min-width:0;}',
    '.kapak-uyari-baslik{font-family:"Space Grotesk",sans-serif;font-weight:700;',
    'font-size:17px;color:var(--ink);margin:0 0 6px;}',
    '.kapak-uyari-metin{font-size:14px;line-height:1.6;color:#4B4F52;margin:0;}',
    '.kapak-uyari-aksiyon{margin-top:20px;display:flex;justify-content:flex-end;}',
    '.kapak-uyari-btn{background:#C0392B;color:#fff;border:none;font-family:inherit;',
    'font-size:14px;font-weight:500;padding:10px 18px;border-radius:7px;cursor:pointer;',
    'white-space:nowrap;transition:background .15s ease, transform .15s ease;}',
    '.kapak-uyari-btn:hover{background:#a8301f;transform:translateY(-1px);}',
    '@keyframes kapakUyariNabiz{0%,100%{box-shadow:0 0 0 0 rgba(192,57,43,0.35);}',
    '50%{box-shadow:0 0 0 6px rgba(192,57,43,0);}}'
  ].join('');
  document.head.appendChild(stil);

  // ── 2) Modal HTML'ini enjekte et ────────────────────────────────────────
  function modaliEkle() {
    if (document.getElementById('uzun-acik-bildirim')) return; // zaten eklenmiş
    var sarmalayici = document.createElement('div');
    sarmalayici.innerHTML =
      '<div class="kapak-uyari-overlay" id="uzun-acik-bildirim" role="alertdialog" aria-live="assertive" aria-labelledby="uzun-acik-bildirim-baslik" aria-describedby="uzun-acik-bildirim-metin">' +
        '<div class="kapak-uyari-banner">' +
          '<div class="kapak-uyari-ikon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
          '</div>' +
          '<div class="kapak-uyari-govde">' +
            '<p class="kapak-uyari-baslik" id="uzun-acik-bildirim-baslik">Kapak uzun süredir açık</p>' +
            '<p class="kapak-uyari-metin" id="uzun-acik-bildirim-metin"></p>' +
            '<div class="kapak-uyari-aksiyon">' +
              '<button class="kapak-uyari-btn" onclick="uzunAcikBildirimErtele()">Farkındayım, Ertele (5 dk)</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sarmalayici.firstChild);
  }

  // ── 3) Mantık ────────────────────────────────────────────────────────────
  var kapakUyariIsimleri = ['Tablet Bakım Kapağı','Su Tahliye Kapağı','Metal Atık kapağı','Cam Atık Kapağı','Plastik Atık Kapağı','Plastik Kapak Kutusu','Ups Kapağı','Üst Pano Kapağı','Pil Kutusu Kapağı','Elektrik Pano Kapağı'];

  var UZUN_ACIK_ESIK_MS = 5 * 60 * 1000;      // 5 dakika
  var UZUN_ACIK_ERTELEME_MS = 5 * 60 * 1000;  // "Ertele" ile verilen ek süre

  var uyariGonderildi = new Array(10).fill(false);
  var sonrakiKontrolZamani = new Array(10).fill(null);
  var bekleyenKapaklar = [];
  var uyariAcikMi = false;

  function localStorageDiziOku(anahtar) {
    try {
      var v = JSON.parse(localStorage.getItem(anahtar) || 'null');
      return (v && v.length === 10) ? v : null;
    } catch (e) { return null; }
  }

  function panelBildirimGoster(baslik, mesaj) {
    var banner = document.getElementById('uzun-acik-bildirim');
    if (!banner) return;
    document.getElementById('uzun-acik-bildirim-baslik').textContent = baslik;
    document.getElementById('uzun-acik-bildirim-metin').textContent = mesaj;
    banner.classList.add('show');
    uyariAcikMi = true;
  }

  function uzunAcikBildirimGizle() {
    var banner = document.getElementById('uzun-acik-bildirim');
    if (banner) banner.classList.remove('show');
    uyariAcikMi = false;
  }

  // onclick="uzunAcikBildirimErtele()" için global scope'ta olmalı
  window.uzunAcikBildirimErtele = function () {
    var simdi = Date.now();
    bekleyenKapaklar.forEach(function (i) {
      sonrakiKontrolZamani[i] = simdi + UZUN_ACIK_ERTELEME_MS;
      uyariGonderildi[i] = false;
    });
    bekleyenKapaklar = [];
    uzunAcikBildirimGizle();
  };

  function kapakUzunSureAcikKontrolEt() {
    var kapaklar = localStorageDiziOku('kapakDurumu');
    var acilmaZamanlari = localStorageDiziOku('kapakAcilmaZamanlari');
    if (!kapaklar || !acilmaZamanlari) return;

    var simdi = Date.now();
    var uyarilacaklar = [];

    for (var i = 0; i < 10; i++) {
      if (!kapaklar[i] || !acilmaZamanlari[i]) continue;
      if (uyariGonderildi[i]) continue;
      if (sonrakiKontrolZamani[i] && simdi < sonrakiKontrolZamani[i]) continue;
      if (simdi - acilmaZamanlari[i] >= UZUN_ACIK_ESIK_MS) {
        uyariGonderildi[i] = true;
        uyarilacaklar.push(i);
      }
    }

    if (!uyarilacaklar.length) return;

    bekleyenKapaklar = uyarilacaklar;
    var isimler = uyarilacaklar.map(function (i) { return kapakUyariIsimleri[i]; });

    if (isimler.length === 1) {
      panelBildirimGoster(
        'Kapak uzun süredir açık',
        isimler[0] + ' 5 dakikadır açık kaldı. Kapağın açık olduğundan haberiniz var mı?'
      );
    } else {
      panelBildirimGoster(
        isimler.length + ' kapak uzun süredir açık',
        isimler.join(', ') + ' en az 5 dakikadır açık. Kapakların açık olduğundan haberiniz var mı?'
      );
    }
  }

  // ── 4) Başlat ────────────────────────────────────────────────────────────
  function baslat() {
    modaliEkle();
    setInterval(kapakUzunSureAcikKontrolEt, 15000);
    kapakUzunSureAcikKontrolEt(); // sayfa açılır açılmaz da bir kez kontrol et
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', baslat);
  } else {
    baslat(); // script </body>'den önce olduğu için DOM zaten hazır olacak
  }

  window.addEventListener('storage', function (e) {
    if (e.key === 'kapakDurumu' || e.key === 'kapakAcilmaZamanlari') {
      kapakUzunSureAcikKontrolEt();
    }
  });
})();