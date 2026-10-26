/* fan.html için localStorage'daki sahte 'makineAcik' simülasyonu yerine
   gerçek backend güç durumunu (GET /api/machines/:id/power) kullanır.
   NOT: Fanların backend'de kendi ünite/sıkışma durumu YOK (fan-veri.js'nin de
   belirttiği gibi, fanlar tamamen ana makinenin AÇIK/KAPALI durumunu takip
   eder). Bu yüzden burada tek yapılan şey 'makineAcik' değerini gerçek
   backend'den güncel tutmak; geri kalanı (tumFanlariAc/tumFanlariKapat,
   ekranGuncelle) fan.html içindeki mevcut fanlariAnaMakineyleSenkronizeEt()
   fonksiyonu üzerinden aynen çalışmaya devam ediyor. */
(function () {
  let timer;

  function hataBannerGoster(mesaj) {
    const wrap = document.getElementById('baglanti-hata-wrap');
    if (!wrap) return;
    if (!mesaj) { wrap.innerHTML = ''; return; }
    wrap.innerHTML =
      '<div class="doluluk-alert" role="alert">' +
        '<span class="doluluk-alert-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>' +
        '</span>' +
        '<div class="doluluk-alert-body">' +
          '<p class="doluluk-alert-title">Bağlantı Sorunu</p>' +
          '<p class="doluluk-alert-text">' + mesaj + '</p>' +
        '</div>' +
      '</div>';
  }

  async function yenile() {
    const api = window.MaltaApi;
    let machineId = api && api.machineId();
    if (!machineId) {
      const machines = await api.request('/api/machines');
      if (!machines.length) throw new Error('Bu kullanıcı için erişilebilir makine bulunamadı.');
      machineId = machines[0].machine_id;
      api.setMachineId(machineId);
    }

    const power = await api.request('/api/machines/' + encodeURIComponent(machineId) + '/power');
    localStorage.setItem('makineAcik', JSON.stringify(Boolean(power && power.is_powered_on)));

    // fan.html'in kendi fonksiyonu: durumu localStorage'daki 'makineAcik' ile
    // karşılaştırıp gerekirse tumFanlariAc()/tumFanlariKapat() çağırır, log
    // ekler ve ekranGuncelle()'i tetikler. Onu aynen yeniden kullanıyoruz.
    if (typeof fanlariAnaMakineyleSenkronizeEt === 'function') {
      fanlariAnaMakineyleSenkronizeEt();
    } else if (typeof ekranGuncelle === 'function') {
      ekranGuncelle();
    }

    hataBannerGoster(null);
  }

  window.apiFanBaslat = function () {
    yenile().catch(function (error) { console.warn('Fan API bağlantısı kurulamadı:', error.message); hataBannerGoster(error.message); });
    timer = window.setInterval(function () {
      yenile().catch(function (error) { console.warn(error.message); hataBannerGoster(error.message); });
    }, 4000);
  };
})();