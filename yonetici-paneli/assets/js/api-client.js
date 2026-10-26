/* ============================================================
   ORTAK API İSTEMCİSİ — window.MaltaApi
   index.html (ve MaltaApi kullanan diğer sayfalar) için genel
   amaçlı, kimlik doğrulamalı backend istemcisi.

   auth.js bu dosyadan ÖNCE yüklenmiş olmalı (AUTH_API_BASE ve
   oturumAccessTokenGetir() buradan kullanılıyor) — tıpkı
   makine-veri.js / doluluk-veri.js'deki gibi.
   ============================================================ */

window.MaltaApi = (function () {
  // 'aktifMakineId' — makineler.html'de bir makine kartına tıklanınca
  // yazılan anahtarla BİREBİR aynı (bkz. doluluk-veri.js'deki
  // aktifMakineIdGetir()). Burada senkron okunuyor çünkü index.html
  // machineId()'i await etmeden, doğrudan senkron çağırıyor.
  function machineId() {
    const kayitliMakineId = localStorage.getItem('aktifMakineId');
    if (kayitliMakineId) return kayitliMakineId;

    // Makinelerim kartları index.html?makine=<id> adresine gider. Tıklama
    // olayı çalışmasa bile (yeni sekme, klavye veya tarayıcı davranışı),
    // adres çubuğundaki kimlikten seçimi geri kazan.
    const urlMakineId = new URLSearchParams(window.location.search).get('makine');
    if (urlMakineId) {
      localStorage.setItem('aktifMakineId', urlMakineId);
      localStorage.setItem('maltaMachineId', urlMakineId);
      return urlMakineId;
    }

    return null;
  }

  // ezme1-api.js / ezme2-api.js / ezme3-api.js, ilk yüklemede henüz bir
  // 'aktifMakineId' yoksa /api/machines listesinden ilk makineyi seçip
  // bu fonksiyonla kaydediyor. machineId() ile aynı anahtarları kullanır.
  function setMachineId(id) {
    localStorage.setItem('aktifMakineId', id);
    localStorage.setItem('maltaMachineId', id);
  }

  async function request(path, secenekler) {
    secenekler = secenekler || {};
    const token = (typeof oturumAccessTokenGetir === 'function') ? oturumAccessTokenGetir() : null;

    const res = await fetch(AUTH_API_BASE + path, Object.assign({}, secenekler, {
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { Authorization: 'Bearer ' + token } : {},
        secenekler.headers || {}
      )
    }));

    if (res.status === 401) {
      // Access token geçersiz/süresi dolmuş → oturumu kapat, login'e dön.
      if (typeof cikisYap === 'function') cikisYap();
      throw new Error('Oturum geçersiz, tekrar giriş yapmanız gerekiyor.');
    }

    if (res.status === 204) return null;

    let veri = null;
    try { veri = await res.json(); } catch (e) { /* boş gövde olabilir */ }

    if (!res.ok) {
      const mesaj = (veri && veri.message) || 'İstek başarısız oldu (' + res.status + ')';
      const hata = new Error(mesaj);
      hata.status = res.status;
      hata.body = veri;
      throw hata;
    }
    return veri;
  }

  return { request: request, machineId: machineId, setMachineId: setMachineId };
})();