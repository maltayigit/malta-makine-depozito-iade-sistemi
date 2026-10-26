/* ekran-durumu.html için localStorage tabanlı ekran verisini REST API'den okumaya çevirir.
   NOT: ekranKartOlustur(), EKRAN_LISTESI, ekranDurumHesapla() gibi render/hesaplama
   fonksiyonları ekran-durumu.html ve ekran-veri.js içinde tanımlı ve global (window)
   kapsamında olduğu için burada aynen yeniden kullanılıyor; sadece veri KAYNAĞI
   (localStorage yerine backend) değişiyor. */
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

  // Backend'den gelen bir screens satırını, ekranDurumHesapla()/ekranKartOlustur()'un
  // beklediği 'kayit' şekline çevirir. Hiç heartbeat gelmemişse null döner (aynı
  // localStorage sürümünde "hiç bağlanmadı" durumuna karşılık gelen davranış).
  function apiKayitOlustur(row) {
    if (!row || !row.last_heartbeat_at) return null;
    return {
      ad: row.display_name,
      sonGorulme: new Date(row.last_heartbeat_at).getTime(),
      sayfaYolu: row.last_page
    };
  }

  function gridCiz(veriler) {
    const grid = document.getElementById('ekran-grid');
    grid.innerHTML = '';

    let cevrimici = 0, cevrimdisi = 0, hic = 0;
    EKRAN_LISTESI.forEach(function (ekranTanim) {
      const kayit = veriler[ekranTanim.id] || null;
      const d = ekranDurumHesapla(kayit);
      if (d.key === 'cevrimici') cevrimici++;
      else if (d.key === 'cevrimdisi') cevrimdisi++;
      else hic++;
      grid.appendChild(ekranKartOlustur(ekranTanim, kayit));
    });

    const ozet = document.getElementById('ekran-ozet');
    ozet.innerHTML = '<strong>' + cevrimici + '</strong> çalışıyor · <strong>' + cevrimdisi + '</strong> çevrimdışı/arızalı · <strong>' + hic + '</strong> hiç bağlanmadı';
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

    const rows = await api.request('/api/machines/' + encodeURIComponent(machineId) + '/screens');
    const veriler = {};
    rows.forEach(function (r) { veriler[r.screen_code] = apiKayitOlustur(r); });

    gridCiz(veriler);
    hataBannerGoster(null);
  }

  window.apiEkranDurumuBaslat = function () {
    yenile().catch(function (error) { console.warn('Ekran Durum API bağlantısı kurulamadı:', error.message); hataBannerGoster(error.message); });
    // Heartbeat'ler 3 sn'de bir gelir, backend 8 sn eşikle offline sayıyor;
    // panelin de aynı ritimde (3 sn) tazelenmesi yeterli ve gereksiz yük yaratmaz.
    timer = window.setInterval(function () {
      yenile().catch(function (error) { console.warn(error.message); hataBannerGoster(error.message); });
    }, 3000);
  };
})();