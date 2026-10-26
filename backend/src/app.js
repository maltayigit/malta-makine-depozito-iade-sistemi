const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { errorHandler, notFoundHandler } = require('./lib/errorHandler');

const authRoutes = require('./routes/auth.routes');
const companiesRoutes = require('./routes/companies.routes');
const marketsRoutes = require('./routes/markets.routes');
const usersRoutes = require('./routes/users.routes');
const machinesRoutes = require('./routes/machines.routes');
const machineOperationsRoutes = require('./routes/machineOperations.routes');
const faultsRoutes = require('./routes/faults.routes');
const serviceRequestsRoutes = require('./routes/serviceRequests.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const activityLogsRoutes = require('./routes/activityLogs.routes');
const sessionsRoutes = require('./routes/sessions.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const registrationsRoutes = require('./routes/registrations.routes');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Auth uç noktalarında brute-force denemelerine karşı ek limit.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Çok fazla deneme yapıldı, lütfen daha sonra tekrar deneyin.' },
});

// Genel API limiti.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authLimiter, authRoutes);
// register.html'in çağırdığı public POST /api/registrations burada; brute-force'a
// karşı authLimiter ile korunuyor, aynı /api/auth mantığı gibi.
app.use('/api/registrations', authLimiter, registrationsRoutes);
app.use('/api', apiLimiter);
app.use('/api/companies', companiesRoutes);
app.use('/api/markets', marketsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/machines', machinesRoutes);
app.use('/api/machines', machineOperationsRoutes);
app.use('/api/faults', faultsRoutes);
app.use('/api/service-requests', serviceRequestsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/activity-logs', activityLogsRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;