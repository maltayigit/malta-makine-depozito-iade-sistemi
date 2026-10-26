/* ezme2.html için localStorage simülasyonunu REST API verisiyle değiştirir. */
(function () {
  let timer;
  let sonUnitSnapshot = null; // önceki polldaki unit verisi (geçiş/log tespiti için)

  function latestValue(rows, type) {
    const item = (rows || []).find(function (row) { return row.sensor_type === type; });
    return item ? Number(item.sensor_value) : null;
  }

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

  // Önceki poll ile şimdiki ünite verisini karşılaştırıp gerçek olayları
  // "Son İşlemler" listesine ekler ve merkezi Acil Durum panelini bilgilendirir.
  function gecisleriIsleVeLogla(unit) {
    if (sonUnitSnapshot) {
      if (!sonUnitSnapshot.is_jammed && unit.is_jammed) {
        state.sonIslemler.unshift({ zaman: saatStr(), text: 'Sıkışma tespit edildi, motor otomatik olarak durduruldu.' });
        if (typeof acilDurumAlarmVer === 'function') {
          acilDurumAlarmVer(ayar.baslik, 'kritik', 'Sıkışma algılandı, motor otomatik olarak durduruldu.');
        }
      }
      if (sonUnitSnapshot.is_jammed && !unit.is_jammed) {
        state.sonIslemler.unshift({ zaman: saatStr(), text: 'Sıkışma giderildi.' });
        if (typeof acilDurumGiderKaynak === 'function') acilDurumGiderKaynak(ayar.baslik);
      }
      if (!sonUnitSnapshot.is_running && unit.is_running && !unit.is_jammed) {
        state.sonIslemler.unshift({ zaman: saatStr(), text: 'Motor çalışmaya başladı.' });
      }
      if (sonUnitSnapshot.is_running && !unit.is_running && !unit.is_jammed) {
        state.sonIslemler.unshift({ zaman: saatStr(), text: 'Motor durduruldu.' });
      }
      if (Number(unit.cycle_count) > Number(sonUnitSnapshot.cycle_count)) {
        state.sonIslemler.unshift({ zaman: saatStr(), text: 'Bir ezme çevrimi tamamlandı (toplam: ' + unit.cycle_count + ').' });
      }
    } else {
      // İlk yüklemede boş bir "bağlanıldı" kaydı, liste tamamen boş görünmesin.
      state.sonIslemler.unshift({ zaman: saatStr(), text: 'Sunucuya bağlanıldı, canlı veri akışı başladı.' });
    }
    state.sonIslemler = state.sonIslemler.slice(0, 8);
    sonUnitSnapshot = unit;
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

    const results = await Promise.all([
      api.request('/api/machines/' + encodeURIComponent(machineId) + '/units'),
      api.request('/api/machines/' + encodeURIComponent(machineId) + '/power'),
      api.request('/api/machines/' + encodeURIComponent(machineId) + '/sensor-data?limit=100')
    ]);
    const unit = results[0].find(function (item) { return item.unit_code === 'ezme2'; });
    if (!unit) throw new Error('Bu makinede ezme2 ünitesi bulunamadı.');
    const sensorRows = results[2];

    gecisleriIsleVeLogla(unit);

    state.calisiyor = Boolean(unit.is_running);
    state.sikisma = Boolean(unit.is_jammed);
    state.bugunSayisi = Number(unit.cycle_count || 0);
    // NOT: 'ezme2_motor_yuku' ve 'ortam_sicakligi' sensör tipi isimleri, cihazın
    // POST /api/machines/:id/sensor-data ile göndereceği sensor_type alanıyla
    // BİREBİR aynı olmalı. Cihaz henüz bu verileri göndermiyorsa 0 gösterilir.
    state.yuk = latestValue(sensorRows, 'ezme2_motor_yuku') ?? 0;
    state.sicaklik = latestValue(sensorRows, 'ortam_sicakligi') ?? 0;
    localStorage.setItem('makineAcik', JSON.stringify(Boolean(results[1].is_powered_on)));

    // Eski localStorage tabanlı diğer scriptlerle (varsa) uyumluluk için durumu
    // da kaydediyoruz; asıl kaynak artık backend.
    kaydet();

    ekranGuncelle();
    alertGoster();
    hataBannerGoster(null);
  }

  window.apiEzme2Baslat = function () {
    yenile().catch(function (error) { console.warn('Ezme 2 API bağlantısı kurulamadı:', error.message); hataBannerGoster(error.message); });
    timer = window.setInterval(function () {
      yenile().catch(function (error) { console.warn(error.message); hataBannerGoster(error.message); });
    }, 5000);
  };

  window.apiEzme2SikismaGider = async function () {
    const api = window.MaltaApi;
    const machineId = api && api.machineId();
    if (!machineId) throw new Error('Makine seçilmedi.');
    await api.request('/api/machines/' + encodeURIComponent(machineId) + '/units/ezme2', {
      method: 'PATCH', body: JSON.stringify({ isJammed: false })
    });
    // Ana makine açıksa motoru tekrar otomatik başlat (cam-kirma.html'deki aynı mantık).
    const power = await api.request('/api/machines/' + encodeURIComponent(machineId) + '/power');
    if (power && power.is_powered_on) {
      await api.request('/api/machines/' + encodeURIComponent(machineId) + '/units/ezme2', {
        method: 'PATCH', body: JSON.stringify({ isRunning: true })
      });
    }
    await yenile();
  };
})();