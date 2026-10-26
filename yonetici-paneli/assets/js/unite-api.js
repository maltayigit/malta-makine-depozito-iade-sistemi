/* ============================================================
   GENEL ÜNİTE API KÖPRÜSÜ (unite.html için)
   ------------------------------------------------------------
   Eskiden her ünite (ezme1-05l, ezme2-05l, ezme1-13l, ezme2-13l, ezme3 ...)
   için ayrı bir dosya vardı (ör. ezme1-05l-api.js, ezme2-05l-api.js) ve
   bu dosyalar birbirinin BİREBİR kopyasıydı — tek fark unit_code ve
   sensör adı string'iydi. Yeni makine/ünite eklemek yeni bir HTML +
   yeni bir JS dosyası kopyalamayı gerektiriyordu.

   Bu dosya bunun yerine tek bir fonksiyon seti sağlar; hangi ünite
   olduğu ('ezme1_05l', 'ezme2_05l', 'ezme3' ...) parametre olarak
   verilir. unite.html?unite=ezme2_05l gibi bir URL açıldığında sayfa
   uniteAyarlari (ezme-veri.js) içinden ilgili config'i okur ve bu
   dosyadaki fonksiyonları o config ile çağırır.

   NOT — ezme2-05l-api.js'de bulunan bug burada DÜZELTİLDİ:
   Eski ezme1-05l-api.js sıkışma anında sikismaBildirimiOlustur(ayar)
   çağırıyordu (diğer üniteleri durdurup makineyi kapatan güvenlik
   zincirini tetikliyordu), ama ezme2-05l-api.js (ve muhtemelen diğer
   kopyalar) bu çağrıyı İÇERMİYORDU — yani o ünitelerdeki bir sıkışma
   sistem genelinde acil durdurmayı tetiklemiyordu. Tek dosya olduğu
   için artık bu tutarsızlık yapısal olarak imkansız.
   ============================================================ */

(function () {
  let timer = null;
  let sonUnitSnapshot = null; // önceki polldaki unit verisi (geçiş/log tespiti için)
  let aktifAyar = null;       // şu an ekranda gösterilen ünitenin config'i

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
  function gecisleriIsleVeLogla(ayar, unit) {
    if (sonUnitSnapshot) {
      if (!sonUnitSnapshot.is_jammed && unit.is_jammed) {
        state.sonIslemler.unshift({ zaman: saatStr(), text: 'Sıkışma tespit edildi, motor otomatik olarak durduruldu.' });
        if (typeof acilDurumAlarmVer === 'function') {
          acilDurumAlarmVer(ayar.baslik, 'kritik', 'Sıkışma algılandı, motor otomatik olarak durduruldu.');
        }
        // Güvenlik zinciri: diğer üniteleri durdur + makineyi backend'de kapat +
        // index.html'in okuyacağı 'sikismaBildirimi' kaydını oluştur. Artık TÜM
        // üniteler için tek yerden ve garanti şekilde çalışır.
        if (typeof sikismaBildirimiOlustur === 'function') {
          sikismaBildirimiOlustur(ayar).catch(function (error) {
            console.error('[unite-api] Sıkışma güvenlik protokolü çalıştırılamadı:', error);
          });
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
      state.sonIslemler.unshift({ zaman: saatStr(), text: 'Sunucuya bağlanıldı, canlı veri akışı başladı.' });
    }
    state.sonIslemler = state.sonIslemler.slice(0, 8);
    sonUnitSnapshot = unit;
  }

  async function yenile(ayar) {
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
    const unit = results[0].find(function (item) { return item.unit_code === ayar.backendKod; });
    if (!unit) throw new Error('Bu makinede ' + ayar.backendKod + ' ünitesi bulunamadı.');
    const sensorRows = results[2];

    gecisleriIsleVeLogla(ayar, unit);

    state.calisiyor = Boolean(unit.is_running);
    state.sikisma = Boolean(unit.is_jammed);
    state.bugunSayisi = Number(unit.cycle_count || 0);
    // Sensör tipi ismi HER ZAMAN '{backendKod}_motor_yuku' kalıbında olmalı;
    // cihaz henüz bu veriyi göndermiyorsa 0 gösterilir.
    state.yuk = latestValue(sensorRows, ayar.backendKod + '_motor_yuku') ?? 0;
    state.sicaklik = latestValue(sensorRows, 'ortam_sicakligi') ?? 0;
    localStorage.setItem('makineAcik', JSON.stringify(Boolean(results[1].is_powered_on)));

    kaydet();
    ekranGuncelle();
    alertGoster();
    hataBannerGoster(null);
  }

  // ── Dışa açılan genel arayüz ───────────────────────────────────────────
  window.UniteApi = {
    baslat: function (ayar) {
      aktifAyar = ayar;
      sonUnitSnapshot = null;
      yenile(ayar).catch(function (error) { console.warn('[' + ayar.backendKod + '] API bağlantısı kurulamadı:', error.message); hataBannerGoster(error.message); });
      if (timer) window.clearInterval(timer);
      timer = window.setInterval(function () {
        yenile(ayar).catch(function (error) { console.warn(error.message); hataBannerGoster(error.message); });
      }, 5000);
    },

    sikismaGider: async function (ayar) {
      const api = window.MaltaApi;
      const machineId = api && api.machineId();
      if (!machineId) throw new Error('Makine seçilmedi.');
      await api.request('/api/machines/' + encodeURIComponent(machineId) + '/units/' + ayar.backendKod, {
        method: 'PATCH', body: JSON.stringify({ isJammed: false })
      });
      // Ana makine açıksa motoru tekrar otomatik başlat.
      const power = await api.request('/api/machines/' + encodeURIComponent(machineId) + '/power');
      if (power && power.is_powered_on) {
        await api.request('/api/machines/' + encodeURIComponent(machineId) + '/units/' + ayar.backendKod, {
          method: 'PATCH', body: JSON.stringify({ isRunning: true })
        });
      }
      await yenile(ayar);
    }
  };
})();
