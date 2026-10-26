/* ============================================================
   ORTAK YETKİLENDİRME (AUTH) DOSYASI — GERÇEK BACKEND SÜRÜMÜ
   Artık localStorage'daki sabit kullanıcı listesi yerine gerçek
   PostgreSQL veritabanına bağlı backend API'sini kullanıyor.
   ============================================================ */

// Backend her zaman 4000 portunda çalışıyor. Adresi sabit yazmak yerine,
// sayfanın o an hangi adresten (localhost, yerel ağ IP'si, gerçek domain vb.)
// açıldığına bakıp aynı host'u kullanıyoruz — böylece aynı kod hem
// localhost'ta hem de "http://10.x.x.x" gibi bir yerel ağ IP'sinden
// başka bir cihazdan açıldığında da doğru backend'e bağlanır.
const AUTH_API_BASE = 'http://' + window.location.hostname + ':4000';

const AUTH_KULLANICI_KEY       = 'oturumKullanici';
const AUTH_ACCESS_TOKEN_KEY    = 'oturumAccessToken';
const AUTH_REFRESH_TOKEN_KEY   = 'oturumRefreshToken';

// Backend'deki 5 rol (SUPER_ADMIN, COMPANY, MARKET, SERVICE_PERSONNEL,
// GOV_AGENCY), sitenin geri kalanının kullandığı basit 'yonetici' / 'market'
// ayrımına eşleniyor. İleride her rol için ayrı arayüz davranışı
// istersen bu eşlemeyi genişletebiliriz.
const AUTH_ROL_ESLEME = {
  SUPER_ADMIN: 'yonetici',
  COMPANY: 'yonetici',
  MARKET: 'market',
  SERVICE_PERSONNEL: 'market',
  GOV_AGENCY: 'bakanlik'
};

function oturumdakiKullanici(){
  try { return JSON.parse(localStorage.getItem(AUTH_KULLANICI_KEY) || 'null'); }
  catch(e){ return null; }
}

function oturumAccessTokenGetir(){
  return localStorage.getItem(AUTH_ACCESS_TOKEN_KEY);
}

/* Artık ASENKRON (Promise döner) — çağıran kodun 'await girisYap(...)'
   ya da '.then(...)' kullanması gerekir. login.html'i buna göre
   ayrıca güncelledik. */
async function girisYap(kullaniciAdi, sifre){
  try {
    const res = await fetch(AUTH_API_BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: kullaniciAdi, password: sifre })
    });

    if (!res.ok) return false;

    const veri = await res.json();
    const rol = AUTH_ROL_ESLEME[veri.user.roleCode] || 'market';

    localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, veri.accessToken);
    localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, veri.refreshToken);
    localStorage.setItem(AUTH_KULLANICI_KEY, JSON.stringify({
      userId: veri.user.userId,
      username: veri.user.username,
      email: veri.user.email,
      adSoyad: veri.user.fullName,
      rol: rol,
      rolKodu: veri.user.roleCode,
      companyId: veri.user.companyId,
      marketId: veri.user.marketId
    }));
    return true;
  } catch (e){
    console.error('[auth] Giriş isteği başarısız (backend çalışıyor mu?):', e);
    return false;
  }
}

// index.html gibi sayfalarda api-client.js, doluluk-veri.js ve ezme-veri.js
// birbirinden BAĞIMSIZ olarak 401 kontrolü yapıp cikisYap()'ı çağırabiliyor.
// Token süresi dolduğunda bu kaynakların polling döngüleri aynı anda 401
// aldığında hepsi ayrı ayrı /api/auth/logout isteği atıyor, bu da log
// tablosunda peş peşe LOGOUT kaydı olarak görünüyordu. Bu flag ile sadece
// ilk çağrı gerçek çıkış işlemini yapıyor, sonrakiler hemen dönüyor.
let _cikisIsleniyor = false;

async function cikisYap(){
  if (_cikisIsleniyor) return;
  _cikisIsleniyor = true;

  const refreshToken = localStorage.getItem(AUTH_REFRESH_TOKEN_KEY);
  try {
    await fetch(AUTH_API_BASE + '/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshToken })
    });
  } catch (e){ /* sunucuya ulaşılamasa da yerel oturumu temizlemeye devam et */ }

  localStorage.removeItem(AUTH_KULLANICI_KEY);
  localStorage.removeItem(AUTH_ACCESS_TOKEN_KEY);
  localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
  window.location.href = 'login.html';
}

/* ── Sayfa koruma ─────────────────────────────────────────────── */
function sayfaKorumaKontrolEt(izinliRoller){
  const kullanici = oturumdakiKullanici();

  if (!kullanici){
    window.location.href = 'login.html';
    return;
  }
  if (izinliRoller && izinliRoller.indexOf(kullanici.rol) === -1){
    alert('Bu sayfayı görüntüleme yetkiniz yok.');
    window.location.href = 'makineler.html';
  }
}

/* ── Menüde role göre gizleme ─────────────────────────────────── */
function menuyuRoleGoreDuzenle(){
  const kullanici = oturumdakiKullanici();
  const rol = kullanici ? kullanici.rol : null;

  document.querySelectorAll('[data-rol]').forEach(function(el){
    const izinliRoller = el.getAttribute('data-rol').split(',').map(function(r){ return r.trim(); });
    el.style.display = (rol && izinliRoller.indexOf(rol) !== -1) ? '' : 'none';
  });

  const adEl = document.getElementById('oturum-kullanici-adi');
  if (adEl && kullanici) adEl.textContent = kullanici.adSoyad;
}

/* ── Bakanlık (GOV_AGENCY) rolü için salt okunur mod ──────────────
   Bakanlık kullanıcısı sitede HİÇBİR ŞEYE etki edememeli, sadece
   görüntüleyebilmeli. Asıl güvenlik sınırı backend'de: bu rolün
   veri değiştiren uç noktalara (aç/kapat, sil, oturum sonlandır vb.)
   yetkisi yok, ilgili istekler zaten 403 ile reddediliyor. Buradaki
   kod sadece UX içindir — kullanıcı işe yaramayan bir butona tıklayıp
   kafası karışmasın diye tüm etkileşimli elemanlar görsel olarak da
   pasifleştiriliyor.

   auth.js her sayfada yüklendiği için bu fonksiyon TEK YERDEN tüm
   siteyi kapsar; her HTML dosyasına ayrı ayrı kod eklemeye gerek yok.

   log-kayitlari.html gibi sayfalarda tablo satırları sayfa yüklendik-
   ten SONRA (fetch sonucu, innerHTML ile) ekleniyor. Bunu yakalamak
   için ilk taramadan sonra bir MutationObserver ile DOM'u sürekli
   izliyoruz.

   İleride belirli bir elemana izin vermek gerekirse (örn. bir filtre
   veya arama kutusunu tekrar aktif etmek), o elemana HTML'de
   data-bakanlik-izin="1" özniteliği eklemek yeterli; bu fonksiyon o
   elemana hiç dokunmaz. */
function bakanlikSaltOkunurStiliEkle(){
  if (document.getElementById('bakanlik-salt-okunur-style')) return;
  const style = document.createElement('style');
  style.id = 'bakanlik-salt-okunur-style';
  style.textContent =
    '.bakanlik-pasif{ opacity:.5 !important; cursor:not-allowed !important; pointer-events:none !important; }';
  document.head.appendChild(style);
}

const BAKANLIK_PASIF_SECICI = 'button, input, select, textarea, a[onclick], a[href="#"]';

function bakanlikIcinElemaniPasiflestir(el){
  if (!el || !el.getAttribute) return;
  if (el.hasAttribute('data-bakanlik-izin')) return; // istisna listesi
  if (el.classList.contains('bakanlik-pasif')) return; // zaten işlendi

  const etiket = el.tagName;

  if (etiket === 'BUTTON' || etiket === 'INPUT' || etiket === 'SELECT' || etiket === 'TEXTAREA'){
    // menu-toggle: mobil hamburger menüsünü aç/kapatan salt-CSS checkbox'ı.
    // Veri/backend ile ilgisi yok, kapatılırsa bakanlık kullanıcısı sitede
    // gezinemez hale gelir — bu yüzden istisna tutuyoruz.
    if (el.id === 'menu-toggle') return;
    el.disabled = true;
    el.classList.add('bakanlik-pasif');
    return;
  }

  if (etiket === 'A'){
    const onclickAttr = el.getAttribute('onclick') || '';
    // Çıkış yapma linkine dokunma — bakanlık kullanıcısı da oturumunu kapatabilmeli
    if (onclickAttr.indexOf('cikisYap') !== -1) return;
    el.classList.add('bakanlik-pasif');
    el.addEventListener('click', function(e){
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }
}

function bakanlikSaltOkunurModunuUygula(){
  const kullanici = oturumdakiKullanici();
  if (!kullanici || kullanici.rol !== 'bakanlik') return;

  bakanlikSaltOkunurStiliEkle();

  document.querySelectorAll(BAKANLIK_PASIF_SECICI).forEach(bakanlikIcinElemaniPasiflestir);

  // Sayfaya sonradan (fetch/innerHTML ile) eklenen elemanları da yakala
  const gozlemci = new MutationObserver(function(mutasyonlar){
    mutasyonlar.forEach(function(m){
      m.addedNodes.forEach(function(node){
        if (node.nodeType !== 1) return; // sadece element node'ları ilgilendiriyor
        if (node.matches && node.matches(BAKANLIK_PASIF_SECICI)) bakanlikIcinElemaniPasiflestir(node);
        if (node.querySelectorAll) node.querySelectorAll(BAKANLIK_PASIF_SECICI).forEach(bakanlikIcinElemaniPasiflestir);
      });
    });
  });
  gozlemci.observe(document.body, { childList: true, subtree: true });
}

document.addEventListener('DOMContentLoaded', bakanlikSaltOkunurModunuUygula);