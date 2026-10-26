# Malta Makine — Yönetim Paneli Backend API

`Yönetici Paneli` klasöründeki HTML/JS arayüzünün (login, index, doluluk,
ezme üniteleri, cam kırma, su karıştırma, ekran durumu, arıza bildir vb.)
ihtiyaç duyduğu tüm veriyi sağlayan REST API. Veritabanı şeması, `veritabani/iade_atik_sistemi.sql` (RBAC v2) dosyasının **birebir aynısıdır**;
hiçbir tablo/kolon değiştirilmedi, sadece frontend'in şu an localStorage'da
simüle ettiği ek durumlar (doluluk bölmeleri, ezme üniteleri, ekran
heartbeat, makine güç durumu) için **üzerine ekleme** yapan ayrı bir
migration (`002_frontend_extensions.sql`) eklendi.

## Mimari

- **Node.js + Express** — REST API katmanı
- **PostgreSQL** (`pg`) — veritabanı
- **JWT** (access + refresh token, `refresh_tokens` tablosunda hash'lenerek
  saklanır ve her yenilemede rotate edilir)
- **RBAC** — `roles`, `permissions`, `role_permissions`, `user_permissions`
  (kullanıcıya özel istisna) ve bunları birleştiren `vw_user_permissions`
  view'ı üzerinden her istekte yetki kontrolü
- **Kapsam (scope) filtreleme** — COMPANY sadece kendi firmasını, MARKET
  sadece kendi marketini, SERVICE_PERSONNEL sadece kendisine atanmış
  makineleri görür; SUPER_ADMIN kısıtsızdır
- **activity_logs** — her yazma işlemi otomatik loglanır
- **notifications** — arıza, kritik doluluk, servis talebi olaylarında
  ilgili kullanıcılara otomatik bildirim oluşturulur

## Klasör Yapısı

```
backend/
  src/
    app.js                     Express uygulaması (middleware + route bağlama)
    server.js                  Giriş noktası
    db.js                      PostgreSQL bağlantı havuzu
    migrations/
      001_core_schema.sql      Çekirdek RBAC şeması (değiştirilmedi)
      002_frontend_extensions.sql  Doluluk/ünite/ekran/güç tabloları (ek)
    scripts/
      migrate.js                Migration çalıştırıcı
      seed.js                   Super Admin kullanıcısı oluşturur
    lib/
      auth.middleware.js         authenticate / requirePermission / requireRole
      scope.js                    Rol bazlı satır filtreleme
      jwt.js, errors.js, errorHandler.js, asyncHandler.js
      activityLog.js, notifications.js
    routes/
      auth.routes.js
      companies.routes.js
      markets.routes.js
      users.routes.js
      machines.routes.js
      machineOperations.routes.js   (bölmeler, üniteler, güç, ekranlar, kapaklar, sensör, komutlar)
      faults.routes.js
      serviceRequests.routes.js
      notifications.routes.js
      activityLogs.routes.js
      dashboard.routes.js
```

## Kurulum

### 1) Bağımlılıklar

```bash
cd backend
npm install
```

### 2) PostgreSQL veritabanını oluşturun

```bash
createdb -U postgres machine_management_db
```

### 3) `.env` dosyasını hazırlayın

```bash
cp .env.example .env
# .env içindeki PGUSER / PGPASSWORD / JWT_* değerlerini kendi ortamınıza göre düzenleyin
```

### 4) Şemayı kurun (migration)

```bash
npm run migrate
```

Bu komut sırasıyla:
1. `001_core_schema.sql` — roller, yetkiler, firmalar, marketler, kullanıcılar,
   makineler, kapaklar, sensörler, arızalar, servis talepleri, bildirimler,
   loglar, RBAC view'ı, trigger'lar ve seed rol/yetki verilerini kurar.
2. `002_frontend_extensions.sql` — doluluk bölmeleri, işleme üniteleri,
   makine güç durumu ve ekran heartbeat tablolarını ekler.

Migrationlar `schema_migrations` tablosunda takip edilir; komutu tekrar
çalıştırmak zaten uygulanmışları atlar.

### 5) İlk Super Admin kullanıcısını oluşturun

```bash
npm run seed
```

`.env` içindeki `SEED_SUPER_ADMIN_*` değerlerini kullanır (varsayılan
kullanıcı adı `admin`). **İlk girişten sonra şifreyi değiştirin.**

### 6) Sunucuyu başlatın

```bash
npm start        # üretim
npm run dev       # geliştirme (dosya değişince otomatik yeniden başlar)
```

API varsayılan olarak `http://localhost:4000` üzerinde çalışır.
Sağlık kontrolü: `GET /health`

## Frontend ile Bağlama

Panel şu an tüm canlı verileri (`doluluk-veri.js`, `ezme-veri.js`,
`ekran-veri.js` ...) `localStorage` üzerinde simüle ediyor. Gerçek
entegrasyon için her dosyanın kendi yorum satırlarında belirttiği gibi,
demo fonksiyonlarının API çağrısına çevrilmesi yeterlidir. Örnek:

```js
// doluluk-veri.js içinde demoVeriUret() yerine:
async function demoVeriUret(){
  const res = await fetch(`${API_BASE}/api/machines/${MACHINE_ID}/doluluk`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return await res.json(); // { plastik, teneke, cam, atiksu }
}
```

`GET /api/machines/:id/doluluk` endpoint'i tam olarak bu şekli döner.

## Kimlik Doğrulama Akışı

1. `POST /api/auth/login` → `{ accessToken, refreshToken, user }`
2. Her isteğe `Authorization: Bearer <accessToken>` ekleyin
3. `accessToken` süresi dolduğunda `POST /api/auth/refresh` ile
   `{ refreshToken }` göndererek yeni bir çift alın (rotasyon uygulanır,
   eski refresh token geçersiz olur)
4. Çıkışta `POST /api/auth/logout` ile refresh token'ı iptal edin

3 başarısız girişten sonra hesap 15 dakika kilitlenir (`users.locked_until`).

## Roller ve Yetkiler (özet)

| Rol | Kapsam | Örnek yetkiler |
|---|---|---|
| `SUPER_ADMIN` | Tüm sistem | Tüm izinler |
| `COMPANY` (Firma/Bakanlık) | Kendi firması | Görüntüleme, rapor, arıza görme |
| `MARKET` | Kendi marketi | Doluluk/durum görme, servis talebi açma |
| `SERVICE_PERSONNEL` | Atandığı makineler | Kapak açma, arıza kaydı, restart, sensör görme |

Tam liste `permissions` tablosunda ve `001_core_schema.sql` içindeki seed
verisinde yer alır. Bir kullanıcıya rolünün dışında ek/istisna yetki tanımlamak
için: `POST /api/users/:id/permissions`.

## API Referansı (özet)

Tüm `/api/*` uçları (login/refresh hariç) `Authorization: Bearer` gerektirir.

### Auth
| Metod | Yol | Açıklama |
|---|---|---|
| POST | `/api/auth/login` | Giriş |
| POST | `/api/auth/refresh` | Token yenile |
| POST | `/api/auth/logout` | Çıkış |
| GET  | `/api/auth/me` | Profil + yetki listesi |
| POST | `/api/auth/change-password` | Kendi şifresini değiştir |

### Firmalar / Marketler / Kullanıcılar
| Metod | Yol |
|---|---|
| GET/POST | `/api/companies` |
| GET/PATCH/DELETE | `/api/companies/:id` |
| PATCH | `/api/companies/:id/settings` |
| GET/POST | `/api/markets` |
| GET/PATCH/DELETE | `/api/markets/:id` |
| GET/POST | `/api/users` |
| GET/PATCH/DELETE | `/api/users/:id` |
| POST | `/api/users/:id/reset-password` |
| GET/POST/DELETE | `/api/users/:id/machines` (servis personeli ataması) |
| POST | `/api/users/:id/permissions` (yetki istisnası) |

### Makineler
| Metod | Yol |
|---|---|
| GET/POST | `/api/machines` |
| GET/PATCH/DELETE | `/api/machines/:id` |
| PATCH | `/api/machines/:id/status` (ACTIVE/PASSIVE) |
| POST | `/api/machines/:id/restart` |
| GET | `/api/machines/:id/compartments` — tüm doluluk bölmeleri |
| GET | `/api/machines/:id/doluluk` — `{plastik,teneke,cam,atiksu}` kısayolu |
| PATCH | `/api/machines/:id/compartments/:code` `{ fillPercent }` |
| POST | `/api/machines/:id/compartments/:code/empty` |
| GET/PATCH | `/api/machines/:id/units` , `/api/machines/:id/units/:code` |
| GET/PATCH | `/api/machines/:id/power` `{ isPoweredOn }` |
| GET | `/api/machines/:id/screens` |
| POST | `/api/machines/:id/screens/:code/heartbeat` |
| GET/PATCH | `/api/machines/:id/covers` , `/api/machines/:id/covers/:coverNumber` |
| GET/POST | `/api/machines/:id/sensor-data` |
| GET/POST/PATCH | `/api/machines/:id/commands` |

### Arıza / Servis / Bildirim / Log / Dashboard
| Metod | Yol |
|---|---|
| GET/POST | `/api/faults` |
| GET/PATCH | `/api/faults/:id` |
| POST | `/api/faults/:id/attachments` |
| GET/POST | `/api/service-requests` |
| PATCH | `/api/service-requests/:id` |
| GET | `/api/notifications` |
| PATCH | `/api/notifications/:id/read` , `/api/notifications/read-all` |
| GET | `/api/activity-logs` |
| GET | `/api/dashboard/summary` , `/api/dashboard/critical-machines` |

## Güvenlik Notları

- Şifreler `bcrypt` (12 round) ile hash'lenir; düz metin asla saklanmaz.
- Cihaz kimlik doğrulaması için `machines.device_api_key` /
  `device_api_secret_hash` alanları hazırdır; secret sadece makine
  oluşturulduğu anda bir defa döner (`deviceApiSecret`), sonrasında sadece
  hash tutulur. Fiziksel cihazların doğrudan API'ye bağlanacağı bir
  senaryoda bu key/secret ile ayrı bir device-auth middleware eklenebilir.
- Auth uçlarında (`/api/auth/*`) 15 dakikada 30 istekle sınırlı rate-limit,
  genel API'de dakikada 300 istekle sınırlı rate-limit uygulanır.
- `helmet` ile güvenlik header'ları, `cors` ile izinli origin kontrolü aktiftir.
- Üretimde `.env` dosyasındaki `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
  değerlerini uzun, rastgele değerlerle değiştirin.

## Sonraki Adımlar (öneri)

- PostgreSQL Row Level Security: `001_core_schema.sql` dosyasının sonunda
  taslağı bırakılmış; isterseniz uygulama seviyesindeki scope kontrolüne ek
  olarak veritabanı seviyesinde de zorunlu kılınabilir.
- WebSocket / Server-Sent Events: doluluk ve ekran durumu gibi verilerin
  polling yerine anlık (push) güncellenmesi istenirse eklenebilir.
- Dosya yükleme: `fault_attachments.file_url` şu an bir URL/string bekler;
  gerçek dosya yükleme için S3/MinIO gibi bir depolama entegre edilebilir.
