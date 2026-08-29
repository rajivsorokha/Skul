const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const db = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads', 'photos')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'student-' + Date.now() + ext);
  }
});
const docStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads', 'documents')),
  filename: (req, file, cb) => cb(null, 'doc-' + Date.now() + path.extname(file.originalname) || '')
});
const uploadPhoto = multer({ storage: photoStorage, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadDoc = multer({ storage: docStorage, limits: { fileSize: 15 * 1024 * 1024 } });
app.use(session({
  secret: 'school-portal-demo-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
app.locals.initials = initials;
app.locals.today = () => new Date().toISOString().slice(0, 10);

function requireAuth(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (role && req.session.user.role !== role) return res.status(403).send('Not authorized for this portal.');
    next();
  };
}

/* ============ AUTH ============ */
app.get('/', (req, res) => res.redirect(req.session.user ? '/' + req.session.user.role : '/login'));

app.get('/login', (req, res) => {
  const users = db.prepare(`SELECT id, name, role FROM users ORDER BY role, name`).all();
  const byRole = { admin: [], teacher: [], staff: [], student: [] };
  users.forEach(u => byRole[u.role].push(u));
  res.render('login', { byRole, error: null });
});

app.post('/login', (req, res) => {
  const { userId } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  if (!user) {
    const users = db.prepare(`SELECT id, name, role FROM users ORDER BY role, name`).all();
    const byRole = { admin: [], teacher: [], staff: [], student: [] };
    users.forEach(u => byRole[u.role].push(u));
    return res.render('login', { byRole, error: 'Please select a user to continue.' });
  }
  req.session.user = { id: user.id, name: user.name, role: user.role, avatar_color: user.avatar_color };
  res.redirect('/' + user.role);
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ============ PLACEHOLDER PORTALS (none left — student & staff now built) ============ */

/* ============ STUDENT: helpers ============ */
function getStudentRecord(userId) {
  return db.prepare(`SELECT s.*, u.name, u.email FROM students s JOIN users u ON u.id = s.user_id WHERE s.user_id = ?`).get(userId);
}

/* ============ STUDENT: DASHBOARD ============ */
app.get('/student', requireAuth('student'), (req, res) => {
  const uid = req.session.user.id;
  const student = getStudentRecord(uid);
  const today = app.locals.today();
  const attRows = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(student.id);
  let present = 0, tot = 0;
  attRows.forEach(r => { if (r.status !== 'holiday') tot += r.c; if (r.status === 'present') present = r.c; });
  const attendancePct = tot ? Math.round(present / tot * 100) : null;

  const hwDue = db.prepare(`SELECT COUNT(*) c FROM homework WHERE class_name=? AND (due_date IS NULL OR due_date >= ?)`).get(student.class_name, today).c;

  const lastResult = db.prepare(`SELECT AVG(marks) avgMarks FROM results WHERE student_id=? AND exam_name=(SELECT exam_name FROM results WHERE student_id=? ORDER BY id DESC LIMIT 1)`).get(student.id, student.id);
  const avgMarks = lastResult && lastResult.avgMarks ? Math.round(lastResult.avgMarks) : null;

  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'short' });
  const todaySchedule = db.prepare(`
    SELECT cs.*, u.name teacher_name FROM class_schedule cs JOIN users u ON u.id = cs.teacher_id
    WHERE cs.class_name=? AND cs.day=? ORDER BY cs.time_range
  `).all(student.class_name, todayName);

  const recentAnnouncements = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC LIMIT 3`).all();

  res.render('student/dashboard', { user: req.session.user, active: 'dashboard', student, attendancePct, hwDue, avgMarks, todaySchedule, recentAnnouncements });
});

/* ============ STUDENT: SCHEDULE ============ */
app.get('/student/schedule', requireAuth('student'), (req, res) => {
  const student = getStudentRecord(req.session.user.id);
  const rows = db.prepare(`
    SELECT cs.*, u.name teacher_name FROM class_schedule cs JOIN users u ON u.id = cs.teacher_id
    WHERE cs.class_name=? ORDER BY ${DAY_ORDER}, cs.time_range
  `).all(student.class_name);
  const byDay = {};
  rows.forEach(r => { (byDay[r.day] = byDay[r.day] || []).push(r); });
  const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  res.render('student/schedule', { user: req.session.user, active: 'schedule', byDay, dayOrder });
});

/* ============ STUDENT: HOMEWORK ============ */
app.get('/student/homework', requireAuth('student'), (req, res) => {
  const student = getStudentRecord(req.session.user.id);
  const rows = db.prepare(`SELECT * FROM homework WHERE class_name=? ORDER BY id DESC`).all(student.class_name);
  res.render('student/homework', { user: req.session.user, active: 'homework', rows });
});

/* ============ STUDENT: MATERIALS ============ */
app.get('/student/materials', requireAuth('student'), (req, res) => {
  const student = getStudentRecord(req.session.user.id);
  const rows = db.prepare(`SELECT * FROM materials WHERE class_name=? ORDER BY date_added DESC`).all(student.class_name);
  res.render('student/materials', { user: req.session.user, active: 'materials', rows });
});

/* ============ STUDENT: RESULTS ============ */
app.get('/student/results', requireAuth('student'), (req, res) => {
  const student = getStudentRecord(req.session.user.id);
  const exams = db.prepare(`SELECT DISTINCT exam_name FROM results WHERE student_id=?`).all(student.id).map(r => r.exam_name);
  const exam = req.query.exam || exams[exams.length - 1] || 'Half Yearly';
  const rows = db.prepare(`SELECT * FROM results WHERE student_id=? AND exam_name=? ORDER BY subject`).all(student.id, exam);
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.marks, 0) / rows.length) : null;
  res.render('student/results', { user: req.session.user, active: 'results', exams, exam, rows, avg });
});

/* ============ STUDENT: ATTENDANCE ============ */
app.get('/student/attendance', requireAuth('student'), (req, res) => {
  const student = getStudentRecord(req.session.user.id);
  const attRows = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(student.id);
  let present = 0, absent = 0, holiday = 0, tot = 0;
  attRows.forEach(r => {
    if (r.status === 'present') present = r.c;
    if (r.status === 'absent') absent = r.c;
    if (r.status === 'holiday') holiday = r.c;
    if (r.status !== 'holiday') tot += r.c;
  });
  const pct = tot ? Math.round(present / tot * 100) : null;
  const last14 = db.prepare(`SELECT date, status FROM attendance WHERE student_id=? ORDER BY date DESC LIMIT 14`).all(student.id).reverse();
  res.render('student/attendance', { user: req.session.user, active: 'attendance', present, absent, holiday, pct, last14 });
});

/* ============ STUDENT: LEAVE ============ */
app.get('/student/leave', requireAuth('student'), (req, res) => {
  const rows = db.prepare(`SELECT * FROM leave_applications WHERE user_id=? AND role='student' ORDER BY created_at DESC`).all(req.session.user.id);
  res.render('student/leave', { user: req.session.user, active: 'leave', rows });
});
app.post('/student/leave', requireAuth('student'), (req, res) => {
  const { type, from_date, to_date, reason } = req.body;
  if (type && from_date && to_date) {
    db.prepare(`INSERT INTO leave_applications (user_id, role, type, from_date, to_date, reason, status) VALUES (?, 'student', ?,?,?,?, 'Pending')`)
      .run(req.session.user.id, type, from_date, to_date, reason || '');
  }
  res.redirect('/student/leave');
});

/* ============ STUDENT: NOTIFICATIONS ============ */
app.get('/student/notifications', requireAuth('student'), (req, res) => {
  const rows = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC`).all();
  res.render('student/notifications', { user: req.session.user, active: 'notifications', rows });
});

/* ============ STUDENT: PROFILE ============ */
app.get('/student/profile', requireAuth('student'), (req, res) => {
  const student = getStudentRecord(req.session.user.id);
  res.render('student/profile', { user: req.session.user, active: 'profile', student });
});

/* ============ STAFF: helpers ============ */
function getStaffRecord(userId) {
  return db.prepare(`SELECT st.*, u.name, u.email, u.phone FROM staff st JOIN users u ON u.id = st.user_id WHERE st.user_id = ?`).get(userId);
}

/* ============ STAFF: DASHBOARD ============ */
app.get('/staff', requireAuth('staff'), (req, res) => {
  const uid = req.session.user.id;
  const staff = getStaffRecord(uid);
  const today = app.locals.today();
  const todayRow = db.prepare(`SELECT * FROM staff_attendance WHERE user_id=? AND date=?`).get(uid, today);

  const monthRows = db.prepare(`SELECT status, COUNT(*) c FROM staff_attendance WHERE user_id=? AND date >= date('now','-30 days') GROUP BY status`).all(uid);
  let present = 0, absent = 0, leave = 0;
  monthRows.forEach(r => { if (r.status === 'present') present = r.c; if (r.status === 'absent') absent = r.c; if (r.status === 'leave') leave = r.c; });

  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'short' });
  const todayDuty = db.prepare(`SELECT * FROM duty_schedule WHERE user_id=? AND day=?`).get(uid, todayName);
  const recentAnnouncements = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC LIMIT 3`).all();

  res.render('staff/dashboard', { user: req.session.user, active: 'dashboard', staff, todayRow, present, absent, leave, todayDuty, recentAnnouncements });
});

app.post('/staff/clock', requireAuth('staff'), (req, res) => {
  const uid = req.session.user.id;
  const today = app.locals.today();
  const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const existing = db.prepare(`SELECT * FROM staff_attendance WHERE user_id=? AND date=?`).get(uid, today);
  if (!existing || !existing.clock_in) {
    db.prepare(`INSERT INTO staff_attendance (user_id, date, status, clock_in) VALUES (?,?, 'present', ?) ON CONFLICT(user_id, date) DO UPDATE SET clock_in=excluded.clock_in, status='present'`).run(uid, today, now);
  } else if (!existing.clock_out) {
    db.prepare(`UPDATE staff_attendance SET clock_out=? WHERE user_id=? AND date=?`).run(now, uid, today);
  }
  res.redirect('/staff');
});

/* ============ STAFF: ATTENDANCE ============ */
app.get('/staff/attendance', requireAuth('staff'), (req, res) => {
  const uid = req.session.user.id;
  const monthRows = db.prepare(`SELECT status, COUNT(*) c FROM staff_attendance WHERE user_id=? AND date >= date('now','-30 days') GROUP BY status`).all(uid);
  let present = 0, absent = 0, leave = 0, tot = 0;
  monthRows.forEach(r => { if (r.status === 'present') present = r.c; if (r.status === 'absent') absent = r.c; if (r.status === 'leave') leave = r.c; tot += r.c; });
  const pct = tot ? Math.round(present / tot * 100) : null;
  const last14 = db.prepare(`SELECT date, status FROM staff_attendance WHERE user_id=? ORDER BY date DESC LIMIT 14`).all(uid).reverse();
  res.render('staff/attendance', { user: req.session.user, active: 'attendance', present, absent, leave, pct, last14 });
});

/* ============ STAFF: LEAVE ============ */
app.get('/staff/leave', requireAuth('staff'), (req, res) => {
  const rows = db.prepare(`SELECT * FROM leave_applications WHERE user_id=? AND role='staff' ORDER BY created_at DESC`).all(req.session.user.id);
  res.render('staff/leave', { user: req.session.user, active: 'leave', rows });
});
app.post('/staff/leave', requireAuth('staff'), (req, res) => {
  const { type, from_date, to_date, reason } = req.body;
  if (type && from_date && to_date) {
    db.prepare(`INSERT INTO leave_applications (user_id, role, type, from_date, to_date, reason, status) VALUES (?, 'staff', ?,?,?,?, 'Pending')`)
      .run(req.session.user.id, type, from_date, to_date, reason || '');
  }
  res.redirect('/staff/leave');
});

/* ============ STAFF: DUTY SCHEDULE ============ */
app.get('/staff/duty', requireAuth('staff'), (req, res) => {
  const uid = req.session.user.id;
  const rows = db.prepare(`SELECT * FROM duty_schedule WHERE user_id=? ORDER BY ${DAY_ORDER}`).all(uid);
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'short' });
  const todayDuty = rows.find(r => r.day === todayName);
  res.render('staff/duty', { user: req.session.user, active: 'duty', rows, todayDuty, todayName });
});

/* ============ STAFF: DIRECTORY ============ */
app.get('/staff/directory', requireAuth('staff'), (req, res) => {
  const admins = db.prepare(`SELECT name, role, phone, 'Administration' dept FROM users WHERE role='admin'`).all();
  const teachers = db.prepare(`SELECT u.name, u.phone, t.subject dept FROM teachers t JOIN users u ON u.id=t.user_id`).all();
  const staffRows = db.prepare(`SELECT u.name, u.phone, st.department dept FROM staff st JOIN users u ON u.id=st.user_id WHERE st.user_id != ?`).all(req.session.user.id);
  const rows = [...admins, ...teachers, ...staffRows];
  res.render('staff/directory', { user: req.session.user, active: 'directory', rows });
});

/* ============ STAFF: PROFILE ============ */
app.get('/staff/profile', requireAuth('staff'), (req, res) => {
  const staff = getStaffRecord(req.session.user.id);
  res.render('staff/profile', { user: req.session.user, active: 'profile', staff });
});

/* ============ TEACHER: helpers ============ */
function getTeacherRecord(userId) {
  return db.prepare(`SELECT t.*, u.name, u.email, u.phone, u.avatar_color FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.user_id = ?`).get(userId);
}
function studentClasses() {
  return db.prepare(`SELECT DISTINCT class_name FROM students ORDER BY class_name`).all().map(r => r.class_name);
}
const DAY_ORDER = "CASE day WHEN 'Mon' THEN 1 WHEN 'Tue' THEN 2 WHEN 'Wed' THEN 3 WHEN 'Thu' THEN 4 WHEN 'Fri' THEN 5 WHEN 'Sat' THEN 6 ELSE 7 END";
function gradeFor(m) { if (m >= 90) return 'A+'; if (m >= 80) return 'A'; if (m >= 70) return 'B+'; if (m >= 60) return 'B'; if (m >= 50) return 'C'; return 'C-'; }

/* ============ TEACHER: DASHBOARD ============ */
app.get('/teacher', requireAuth('teacher'), (req, res) => {
  const uid = req.session.user.id;
  const teacher = getTeacherRecord(uid);
  const myClass = teacher.class_teacher_of || null;
  const studentCount = myClass ? db.prepare(`SELECT COUNT(*) c FROM students WHERE class_name=?`).get(myClass).c : 0;
  const pendingApprovals = myClass
    ? db.prepare(`SELECT COUNT(*) c FROM leave_applications la JOIN students s ON s.user_id = la.user_id WHERE la.role='student' AND la.status='Pending' AND s.class_name=?`).get(myClass).c
    : 0;
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'short' });
  const classesToday = db.prepare(`SELECT COUNT(*) c FROM class_schedule WHERE teacher_id=? AND day=?`).get(uid, todayName).c;
  let avgAttendance = null;
  if (myClass) {
    const today = app.locals.today();
    const rows = db.prepare(`SELECT a.status, COUNT(*) c FROM attendance a JOIN students s ON s.id=a.student_id WHERE s.class_name=? AND a.date=? GROUP BY a.status`).all(myClass, today);
    let present = 0, tot = 0;
    rows.forEach(r => { tot += r.c; if (r.status === 'present') present = r.c; });
    avgAttendance = tot ? Math.round(present / tot * 100) : null;
  }
  const myPendingLeave = db.prepare(`SELECT COUNT(*) c FROM leave_applications WHERE user_id=? AND role='teacher' AND status='Pending'`).get(uid).c;
  const recentAnnouncements = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC LIMIT 4`).all();

  res.render('teacher/dashboard', {
    user: req.session.user, active: 'dashboard', teacher, myClass,
    studentCount, pendingApprovals, classesToday, avgAttendance, myPendingLeave, recentAnnouncements
  });
});

/* ============ TEACHER: MARK ATTENDANCE ============ */
app.get('/teacher/attendance', requireAuth('teacher'), (req, res) => {
  const uid = req.session.user.id;
  const teacher = getTeacherRecord(uid);
  const classes = studentClasses();
  const cls = req.query.cls || teacher.class_teacher_of || classes[0];
  const date = req.query.date || app.locals.today();
  const students = db.prepare(`
    SELECT s.id, u.name, s.roll_no, COALESCE(a.status,'present') status
    FROM students s JOIN users u ON u.id = s.user_id
    LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
    WHERE s.class_name = ? ORDER BY s.roll_no
  `).all(date, cls);
  res.render('teacher/attendance', { user: req.session.user, active: 'attendance', classes, cls, date, students });
});

app.post('/teacher/attendance', requireAuth('teacher'), (req, res) => {
  const { cls, date } = req.body;
  const upsert = db.prepare(`INSERT INTO attendance (student_id, date, status) VALUES (?,?,?) ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status`);
  Object.keys(req.body).forEach(key => {
    if (key.startsWith('status_')) {
      const studentId = key.replace('status_', '');
      upsert.run(studentId, date, req.body[key]);
    }
  });
  res.redirect(`/teacher/attendance?cls=${encodeURIComponent(cls)}&date=${date}`);
});

/* ============ TEACHER: SCHEDULE ============ */
app.get('/teacher/schedule', requireAuth('teacher'), (req, res) => {
  const uid = req.session.user.id;
  const rows = db.prepare(`SELECT * FROM class_schedule WHERE teacher_id=? ORDER BY ${DAY_ORDER}, time_range`).all(uid);
  const byDay = {};
  rows.forEach(r => { (byDay[r.day] = byDay[r.day] || []).push(r); });
  const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  res.render('teacher/schedule', { user: req.session.user, active: 'schedule', byDay, dayOrder });
});

/* ============ TEACHER: HOMEWORK ============ */
app.get('/teacher/homework', requireAuth('teacher'), (req, res) => {
  const uid = req.session.user.id;
  const teacher = getTeacherRecord(uid);
  const rows = db.prepare(`SELECT * FROM homework WHERE posted_by=? ORDER BY id DESC`).all(uid);
  const classes = studentClasses();
  res.render('teacher/homework', { user: req.session.user, active: 'homework', rows, classes, teacher });
});
app.post('/teacher/homework', requireAuth('teacher'), (req, res) => {
  const uid = req.session.user.id;
  const teacher = getTeacherRecord(uid);
  const { title, class_name, due_date } = req.body;
  if (title && class_name) {
    db.prepare(`INSERT INTO homework (class_name, subject, title, due_date, posted_by) VALUES (?,?,?,?,?)`)
      .run(class_name, teacher.subject, title, due_date || null, uid);
  }
  res.redirect('/teacher/homework');
});
app.post('/teacher/homework/:id/delete', requireAuth('teacher'), (req, res) => {
  db.prepare(`DELETE FROM homework WHERE id=? AND posted_by=?`).run(req.params.id, req.session.user.id);
  res.redirect('/teacher/homework');
});

/* ============ TEACHER: EXAM MARKS ENTRY ============ */
app.get('/teacher/marks', requireAuth('teacher'), (req, res) => {
  const uid = req.session.user.id;
  const teacher = getTeacherRecord(uid);
  const classes = studentClasses();
  const cls = req.query.cls || teacher.class_teacher_of || classes[0];
  const exam = req.query.exam || 'Half Yearly';
  const students = db.prepare(`
    SELECT s.id, u.name, s.roll_no, r.marks
    FROM students s JOIN users u ON u.id = s.user_id
    LEFT JOIN results r ON r.student_id = s.id AND r.exam_name = ? AND r.subject = ?
    WHERE s.class_name = ? ORDER BY s.roll_no
  `).all(exam, teacher.subject, cls);
  res.render('teacher/marks', { user: req.session.user, active: 'marks', classes, cls, exam, exams: ['Term 1', 'Half Yearly'], students, subject: teacher.subject });
});
app.post('/teacher/marks', requireAuth('teacher'), (req, res) => {
  const uid = req.session.user.id;
  const teacher = getTeacherRecord(uid);
  const { cls, exam, action } = req.body;
  if (action === 'publish') {
    const upsert = db.prepare(`
      INSERT INTO results (student_id, exam_name, subject, marks, grade) VALUES (?,?,?,?,?)
      ON CONFLICT(student_id, exam_name, subject) DO UPDATE SET marks=excluded.marks, grade=excluded.grade
    `);
    Object.keys(req.body).forEach(key => {
      if (key.startsWith('marks_') && req.body[key] !== '') {
        const studentId = key.replace('marks_', '');
        const marks = parseInt(req.body[key], 10);
        if (!isNaN(marks)) {
          try {
            upsert.run(studentId, exam, teacher.subject, marks, gradeFor(marks));
          } catch (e) {
            // fallback if no unique constraint exists on this older DB — manual check
            const existing = db.prepare(`SELECT id FROM results WHERE student_id=? AND exam_name=? AND subject=?`).get(studentId, exam, teacher.subject);
            if (existing) db.prepare(`UPDATE results SET marks=?, grade=? WHERE id=?`).run(marks, gradeFor(marks), existing.id);
            else db.prepare(`INSERT INTO results (student_id, exam_name, subject, marks, grade) VALUES (?,?,?,?,?)`).run(studentId, exam, teacher.subject, marks, gradeFor(marks));
          }
        }
      }
    });
  }
  res.redirect(`/teacher/marks?cls=${encodeURIComponent(cls)}&exam=${encodeURIComponent(exam)}`);
});

/* ============ TEACHER: STUDENT PROFILES ============ */
app.get('/teacher/students', requireAuth('teacher'), (req, res) => {
  const teacher = getTeacherRecord(req.session.user.id);
  const classes = studentClasses();
  const cls = req.query.cls || teacher.class_teacher_of || classes[0];
  const students = db.prepare(`SELECT s.*, u.name FROM students s JOIN users u ON u.id=s.user_id WHERE s.class_name=? ORDER BY s.roll_no`).all(cls);
  const withStats = students.map(s => {
    const att = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(s.id);
    let present = 0, tot = 0;
    att.forEach(r => { if (r.status !== 'holiday') tot += r.c; if (r.status === 'present') present = r.c; });
    const pct = tot ? Math.round(present / tot * 100) : null;
    return { ...s, attendancePct: pct };
  });
  res.render('teacher/students', { user: req.session.user, active: 'students', classes, cls, students: withStats });
});
app.get('/teacher/students/:id', requireAuth('teacher'), (req, res) => {
  const s = db.prepare(`SELECT s.*, u.name, u.email FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?`).get(req.params.id);
  if (!s) return res.status(404).send('Student not found');
  const att = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(s.id);
  let present = 0, tot = 0;
  att.forEach(r => { if (r.status !== 'holiday') tot += r.c; if (r.status === 'present') present = r.c; });
  const attendancePct = tot ? Math.round(present / tot * 100) : null;
  const results = db.prepare(`SELECT * FROM results WHERE student_id=? ORDER BY exam_name, subject`).all(s.id);
  res.render('teacher/student-detail', { user: req.session.user, active: 'students', s, attendancePct, results });
});

/* ============ TEACHER: LEAVE APPROVALS (their class's students) ============ */
app.get('/teacher/leaves', requireAuth('teacher'), (req, res) => {
  const teacher = getTeacherRecord(req.session.user.id);
  const myClass = teacher.class_teacher_of;
  const filter = req.query.status || 'Pending';
  let rows = myClass
    ? db.prepare(`
        SELECT la.*, u.name applicant_name FROM leave_applications la
        JOIN users u ON u.id = la.user_id
        JOIN students s ON s.user_id = la.user_id
        WHERE la.role='student' AND s.class_name = ?
        ORDER BY la.created_at DESC
      `).all(myClass)
    : [];
  const counts = { Pending: 0, Approved: 0, Rejected: 0 };
  rows.forEach(r => counts[r.status]++);
  if (filter !== 'all') rows = rows.filter(r => r.status === filter);
  res.render('teacher/leaves', { user: req.session.user, active: 'leaves', rows, filter, counts, myClass });
});
app.post('/teacher/leaves/:id/decide', requireAuth('teacher'), (req, res) => {
  db.prepare(`UPDATE leave_applications SET status=? WHERE id=? AND role='student'`).run(req.body.status, req.params.id);
  res.redirect(req.headers.referer || '/teacher/leaves');
});

/* ============ TEACHER: MY LEAVE ============ */
app.get('/teacher/myleave', requireAuth('teacher'), (req, res) => {
  const rows = db.prepare(`SELECT * FROM leave_applications WHERE user_id=? AND role='teacher' ORDER BY created_at DESC`).all(req.session.user.id);
  res.render('teacher/myleave', { user: req.session.user, active: 'myleave', rows });
});
app.post('/teacher/myleave', requireAuth('teacher'), (req, res) => {
  const { type, from_date, to_date, reason } = req.body;
  if (type && from_date && to_date) {
    db.prepare(`INSERT INTO leave_applications (user_id, role, type, from_date, to_date, reason, status) VALUES (?, 'teacher', ?,?,?,?, 'Pending')`)
      .run(req.session.user.id, type, from_date, to_date, reason || '');
  }
  res.redirect('/teacher/myleave');
});

/* ============ TEACHER: ANNOUNCEMENTS ============ */
app.get('/teacher/announcements', requireAuth('teacher'), (req, res) => {
  const teacher = getTeacherRecord(req.session.user.id);
  const rows = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC`).all();
  res.render('teacher/announcements', { user: req.session.user, active: 'announcements', rows, teacher });
});
app.post('/teacher/announcements', requireAuth('teacher'), (req, res) => {
  const teacher = getTeacherRecord(req.session.user.id);
  const { title, message } = req.body;
  if (title && message) {
    db.prepare(`INSERT INTO announcements (title, message, audience) VALUES (?,?,?)`)
      .run(title, message, `Class ${teacher.class_teacher_of || teacher.subject}`);
  }
  res.redirect('/teacher/announcements');
});

/* ============ TEACHER: PROFILE ============ */
app.get('/teacher/profile', requireAuth('teacher'), (req, res) => {
  const teacher = getTeacherRecord(req.session.user.id);
  res.render('teacher/profile', { user: req.session.user, active: 'profile', teacher });
});

/* ============ ADMIN: DASHBOARD ============ */
app.get('/admin', requireAuth('admin'), (req, res) => {
  const totalStudents = db.prepare(`SELECT COUNT(*) c FROM students`).get().c;
  const totalTeachers = db.prepare(`SELECT COUNT(*) c FROM teachers`).get().c;
  const totalStaff = db.prepare(`SELECT COUNT(*) c FROM staff`).get().c;
  const pendingLeaves = db.prepare(`SELECT COUNT(*) c FROM leave_applications WHERE status='Pending'`).get().c;

  const today = app.locals.today();
  const attToday = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE date = ? GROUP BY status`).all(today);
  let present = 0, total = 0;
  attToday.forEach(r => { total += r.c; if (r.status === 'present') present = r.c; });
  const attendancePct = total ? Math.round((present / total) * 100) : null;

  const feesCollected = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fees WHERE status='paid' AND term LIKE 'Term%'`).get().s;
  const feesDue = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fees WHERE status='due'`).get().s;

  const recentAnnouncements = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC LIMIT 4`).all();
  const recentLeaves = db.prepare(`SELECT * FROM leave_applications WHERE status='Pending' ORDER BY created_at DESC LIMIT 5`).all()
    .map(l => ({ ...l, applicant: db.prepare(`SELECT name FROM users WHERE id=?`).get(l.user_id)?.name }));

  const classCounts = db.prepare(`SELECT class_name, COUNT(*) c FROM students GROUP BY class_name`).all();

  const upcomingEvents = db.prepare(`SELECT * FROM events WHERE date >= ? ORDER BY date LIMIT 3`).all(today);
  const booksTotal = db.prepare(`SELECT COUNT(*) c FROM books`).get().c;
  const booksIssued = db.prepare(`SELECT COUNT(*) c FROM book_issues WHERE return_date IS NULL`).get().c;
  const activeStudents = db.prepare(`SELECT COUNT(*) c FROM students WHERE status='active'`).get().c;

  res.render('admin/dashboard', {
    user: req.session.user, active: 'dashboard',
    stats: { totalStudents, totalTeachers, totalStaff, pendingLeaves, attendancePct, feesCollected, feesDue, activeStudents, booksTotal, booksIssued },
    recentAnnouncements, recentLeaves, classCounts, upcomingEvents
  });
});

/* ============ ADMIN: USER MANAGEMENT ============ */
app.get('/admin/users', requireAuth('admin'), (req, res) => {
  const tab = req.query.tab || 'students';
  const students = db.prepare(`SELECT s.*, u.name, u.email, u.phone FROM students s JOIN users u ON u.id = s.user_id ORDER BY u.name`).all();
  const teachers = db.prepare(`SELECT t.*, u.name, u.email, u.phone FROM teachers t JOIN users u ON u.id = t.user_id ORDER BY u.name`).all();
  const staff = db.prepare(`SELECT st.*, u.name, u.email, u.phone FROM staff st JOIN users u ON u.id = st.user_id ORDER BY u.name`).all();
  res.render('admin/users', { user: req.session.user, active: 'users', tab, students, teachers, staff });
});

app.post('/admin/users/students', requireAuth('admin'), (req, res) => {
  const { name, roll_no, class_name, parent_name, parent_phone, blood_group } = req.body;
  const u = db.prepare(`INSERT INTO users (name, role, email, phone, avatar_color) VALUES (?, 'student', ?, ?, '#8B5CF6')`)
    .run(name, `${name.toLowerCase().replace(/\s+/g, '.')}@stjosephschandel.in`, parent_phone);
  db.prepare(`INSERT INTO students (user_id, roll_no, class_name, parent_name, parent_phone, blood_group, bus_route) VALUES (?,?,?,?,?,?,?)`)
    .run(u.lastInsertRowid, roll_no || null, class_name, parent_name, parent_phone, blood_group, 'Route 6');
  res.redirect('/admin/users?tab=students');
});

app.post('/admin/users/students/:id/delete', requireAuth('admin'), (req, res) => {
  const s = db.prepare(`SELECT user_id FROM students WHERE id = ?`).get(req.params.id);
  if (s) db.prepare(`DELETE FROM users WHERE id = ?`).run(s.user_id); // cascades
  res.redirect('/admin/users?tab=students');
});

app.post('/admin/users/teachers', requireAuth('admin'), (req, res) => {
  const { name, subject, class_teacher_of, phone } = req.body;
  const u = db.prepare(`INSERT INTO users (name, role, email, phone, avatar_color) VALUES (?, 'teacher', ?, ?, '#4C8DA6')`)
    .run(name, `${name.toLowerCase().replace(/\s+/g, '.')}@stjosephschandel.in`, phone);
  db.prepare(`INSERT INTO teachers (user_id, employee_id, subject, class_teacher_of) VALUES (?,?,?,?)`)
    .run(u.lastInsertRowid, 'EMP-' + (1000 + u.lastInsertRowid), subject, class_teacher_of || '');
  res.redirect('/admin/users?tab=teachers');
});

app.post('/admin/users/teachers/:id/delete', requireAuth('admin'), (req, res) => {
  const t = db.prepare(`SELECT user_id FROM teachers WHERE id = ?`).get(req.params.id);
  if (t) db.prepare(`DELETE FROM users WHERE id = ?`).run(t.user_id);
  res.redirect('/admin/users?tab=teachers');
});

app.post('/admin/users/staff', requireAuth('admin'), (req, res) => {
  const { name, department, designation, phone } = req.body;
  const u = db.prepare(`INSERT INTO users (name, role, email, phone, avatar_color) VALUES (?, 'staff', ?, ?, '#64748B')`)
    .run(name, `${name.toLowerCase().replace(/\s+/g, '.')}@stjosephschandel.in`, phone);
  db.prepare(`INSERT INTO staff (user_id, employee_id, department, designation) VALUES (?,?,?,?)`)
    .run(u.lastInsertRowid, 'EMP-' + (2000 + u.lastInsertRowid), department, designation);
  res.redirect('/admin/users?tab=staff');
});

app.post('/admin/users/staff/:id/delete', requireAuth('admin'), (req, res) => {
  const s = db.prepare(`SELECT user_id FROM staff WHERE id = ?`).get(req.params.id);
  if (s) db.prepare(`DELETE FROM users WHERE id = ?`).run(s.user_id);
  res.redirect('/admin/users?tab=staff');
});

/* ============ ADMIN: ATTENDANCE REPORTS ============ */
app.get('/admin/attendance', requireAuth('admin'), (req, res) => {
  const classes = db.prepare(`SELECT DISTINCT class_name FROM students ORDER BY class_name`).all().map(r => r.class_name);
  const cls = req.query.cls || classes[0] || '8-B';
  const date = req.query.date || app.locals.today();

  const rows = db.prepare(`
    SELECT u.name, s.roll_no, COALESCE(a.status,'not marked') status
    FROM students s JOIN users u ON u.id = s.user_id
    LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
    WHERE s.class_name = ?
    ORDER BY s.roll_no
  `).all(date, cls);

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const dayRows = db.prepare(`
      SELECT a.status, COUNT(*) c FROM attendance a JOIN students s ON s.id = a.student_id
      WHERE s.class_name = ? AND a.date = ? GROUP BY a.status
    `).all(cls, iso);
    let present = 0, tot = 0;
    dayRows.forEach(r => { tot += r.c; if (r.status === 'present') present = r.c; });
    last7.push({ label: d.toLocaleDateString('en-US', { weekday: 'short' }), pct: tot ? Math.round(present / tot * 100) : 0 });
  }

  res.render('admin/attendance', { user: req.session.user, active: 'attendance', classes, cls, date, rows, last7 });
});

/* ============ ADMIN: FEES ============ */
app.get('/admin/fees', requireAuth('admin'), (req, res) => {
  const filter = req.query.status || 'all';
  let query = `SELECT f.*, u.name student_name, s.class_name FROM fees f JOIN students s ON s.id = f.student_id JOIN users u ON u.id = s.user_id`;
  if (filter !== 'all') query += ` WHERE f.status = '${filter === 'paid' ? 'paid' : 'due'}'`;
  query += ` ORDER BY f.status ASC, f.due_date ASC`;
  const rows = db.prepare(query).all();

  const totalCollected = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fees WHERE status='paid'`).get().s;
  const totalDue = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fees WHERE status='due'`).get().s;
  const countDue = db.prepare(`SELECT COUNT(*) c FROM fees WHERE status='due'`).get().c;

  res.render('admin/fees', { user: req.session.user, active: 'fees', rows, filter, totalCollected, totalDue, countDue });
});

app.post('/admin/fees/:id/mark-paid', requireAuth('admin'), (req, res) => {
  const receiptNo = 'RCT-' + Math.floor(10000 + Math.random() * 89999);
  db.prepare(`UPDATE fees SET status='paid', paid_date=?, receipt_no=? WHERE id=?`)
    .run(app.locals.today(), receiptNo, req.params.id);
  res.redirect('back' in req.headers ? req.headers.referer : '/admin/fees');
});

/* ============ ADMIN: LEAVE MANAGEMENT ============ */
app.get('/admin/leaves', requireAuth('admin'), (req, res) => {
  const filter = req.query.status || 'Pending';
  let rows = db.prepare(`SELECT * FROM leave_applications ORDER BY created_at DESC`).all();
  if (filter !== 'all') rows = rows.filter(l => l.status === filter);
  rows = rows.map(l => ({ ...l, applicant: db.prepare(`SELECT name, role FROM users WHERE id=?`).get(l.user_id) }));
  const counts = {
    Pending: db.prepare(`SELECT COUNT(*) c FROM leave_applications WHERE status='Pending'`).get().c,
    Approved: db.prepare(`SELECT COUNT(*) c FROM leave_applications WHERE status='Approved'`).get().c,
    Rejected: db.prepare(`SELECT COUNT(*) c FROM leave_applications WHERE status='Rejected'`).get().c,
  };
  res.render('admin/leaves', { user: req.session.user, active: 'leaves', rows, filter, counts });
});

app.post('/admin/leaves/:id/decide', requireAuth('admin'), (req, res) => {
  db.prepare(`UPDATE leave_applications SET status=? WHERE id=?`).run(req.body.status, req.params.id);
  res.redirect(req.headers.referer || '/admin/leaves');
});

/* ============ ADMIN: ANNOUNCEMENTS ============ */
app.get('/admin/announcements', requireAuth('admin'), (req, res) => {
  const rows = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC`).all();
  res.render('admin/announcements', { user: req.session.user, active: 'announcements', rows });
});
app.post('/admin/announcements', requireAuth('admin'), (req, res) => {
  const { title, message, audience } = req.body;
  if (title && message) db.prepare(`INSERT INTO announcements (title, message, audience) VALUES (?,?,?)`).run(title, message, audience);
  res.redirect('/admin/announcements');
});
app.post('/admin/announcements/:id/delete', requireAuth('admin'), (req, res) => {
  db.prepare(`DELETE FROM announcements WHERE id=?`).run(req.params.id);
  res.redirect('/admin/announcements');
});

/* ============ ADMIN: CLASSES & TIMETABLE ============ */
app.get('/admin/classes', requireAuth('admin'), (req, res) => {
  const classes = db.prepare(`SELECT c.*, u.name teacher_name FROM classes c LEFT JOIN users u ON u.id = c.class_teacher_id`).all()
    .map(c => ({ ...c, studentCount: db.prepare(`SELECT COUNT(*) c FROM students WHERE class_name=?`).get(c.name).c }));
  const teachers = db.prepare(`SELECT t.user_id, u.name FROM teachers t JOIN users u ON u.id = t.user_id`).all();
  res.render('admin/classes', { user: req.session.user, active: 'classes', classes, teachers });
});
app.post('/admin/classes', requireAuth('admin'), (req, res) => {
  const { name } = req.body;
  if (name) { try { db.prepare(`INSERT INTO classes (name) VALUES (?)`).run(name); } catch (e) {} }
  res.redirect('/admin/classes');
});
app.post('/admin/classes/:id/assign-teacher', requireAuth('admin'), (req, res) => {
  db.prepare(`UPDATE classes SET class_teacher_id=? WHERE id=?`).run(req.body.teacher_id || null, req.params.id);
  res.redirect('/admin/classes');
});

/* ============ ADMIN: TRANSPORT ============ */
app.get('/admin/transport', requireAuth('admin'), (req, res) => {
  const routes = db.prepare(`SELECT r.*, u.name driver_name, u.phone driver_phone FROM bus_routes r LEFT JOIN users u ON u.id = r.driver_user_id`).all()
    .map(r => ({ ...r, studentCount: db.prepare(`SELECT COUNT(*) c FROM students WHERE bus_route=?`).get(r.route_name).c }));
  const drivers = db.prepare(`SELECT st.user_id, u.name FROM staff st JOIN users u ON u.id = st.user_id WHERE st.designation LIKE '%Driver%'`).all();
  res.render('admin/transport', { user: req.session.user, active: 'transport', routes, drivers });
});

/* ============ ADMIN: REPORTS & EXPORTS ============ */
app.get('/admin/reports', requireAuth('admin'), (req, res) => {
  res.render('admin/reports', { user: req.session.user, active: 'reports' });
});
app.get('/admin/reports/export/:type', requireAuth('admin'), (req, res) => {
  const type = req.params.type;
  let csv = '';
  if (type === 'students') {
    const rows = db.prepare(`SELECT u.name, s.roll_no, s.class_name, s.parent_name, s.parent_phone FROM students s JOIN users u ON u.id=s.user_id ORDER BY s.class_name, s.roll_no`).all();
    csv = 'Name,Roll No,Class,Parent Name,Parent Phone\n' + rows.map(r => `"${r.name}",${r.roll_no},"${r.class_name}","${r.parent_name}","${r.parent_phone}"`).join('\n');
  } else if (type === 'fees') {
    const rows = db.prepare(`SELECT u.name, s.class_name, f.term, f.amount, f.status, f.due_date FROM fees f JOIN students s ON s.id=f.student_id JOIN users u ON u.id=s.user_id ORDER BY f.status, u.name`).all();
    csv = 'Student,Class,Term,Amount,Status,Due Date\n' + rows.map(r => `"${r.name}","${r.class_name}","${r.term}",${r.amount},${r.status},${r.due_date || ''}`).join('\n');
  } else if (type === 'attendance') {
    const rows = db.prepare(`SELECT u.name, s.class_name, a.date, a.status FROM attendance a JOIN students s ON s.id=a.student_id JOIN users u ON u.id=s.user_id ORDER BY a.date DESC`).all();
    csv = 'Student,Class,Date,Status\n' + rows.map(r => `"${r.name}","${r.class_name}",${r.date},${r.status}`).join('\n');
  } else {
    return res.status(404).send('Unknown report');
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`);
  res.send(csv);
});

/* ============ ADMIN: LIBRARY ============ */
app.get('/admin/library', requireAuth('admin'), (req, res) => {
  const books = db.prepare(`SELECT * FROM books ORDER BY title`).all().map(b => ({
    ...b,
    issued: b.total_copies - b.available_copies,
    activeIssues: db.prepare(`
      SELECT bi.*, u.name student_name, s.class_name FROM book_issues bi
      JOIN students s ON s.id = bi.student_id
      JOIN users u ON u.id = s.user_id
      WHERE bi.book_id = ? AND bi.return_date IS NULL
    `).all(b.id)
  }));
  const students = db.prepare(`SELECT s.id, u.name FROM students s JOIN users u ON u.id = s.user_id ORDER BY u.name`).all();
  res.render('admin/library', { user: req.session.user, active: 'library', books, students });
});

app.post('/admin/library', requireAuth('admin'), (req, res) => {
  const { title, author, isbn, category, total_copies } = req.body;
  if (title) {
    const n = Math.max(1, parseInt(total_copies, 10) || 1);
    db.prepare(`INSERT INTO books (title, author, isbn, category, total_copies, available_copies) VALUES (?,?,?,?,?,?)`)
      .run(title, author, isbn, category, n, n);
  }
  res.redirect('/admin/library');
});

app.post('/admin/library/:id/issue', requireAuth('admin'), (req, res) => {
  const { student_id, due_date } = req.body;
  const book = db.prepare(`SELECT * FROM books WHERE id=?`).get(req.params.id);
  if (book && book.available_copies > 0 && student_id) {
    db.prepare(`INSERT INTO book_issues (book_id, student_id, issue_date, due_date) VALUES (?,?,?,?)`)
      .run(req.params.id, student_id, app.locals.today(), due_date);
    db.prepare(`UPDATE books SET available_copies = available_copies - 1 WHERE id=?`).run(req.params.id);
  }
  res.redirect('/admin/library');
});

app.post('/admin/library/:id/return/:issueId', requireAuth('admin'), (req, res) => {
  const issue = db.prepare(`SELECT * FROM book_issues WHERE id=? AND return_date IS NULL`).get(req.params.issueId);
  if (issue) {
    db.prepare(`UPDATE book_issues SET return_date=? WHERE id=?`).run(app.locals.today(), req.params.issueId);
    db.prepare(`UPDATE books SET available_copies = available_copies + 1 WHERE id=?`).run(req.params.id);
  }
  res.redirect('/admin/library');
});

/* ============ ADMIN: EVENTS ============ */
app.get('/admin/events', requireAuth('admin'), (req, res) => {
  const rows = db.prepare(`SELECT * FROM events ORDER BY date ASC`).all();
  res.render('admin/events', { user: req.session.user, active: 'events', rows });
});
app.post('/admin/events', requireAuth('admin'), (req, res) => {
  const { title, date, time_range, location, audience, description } = req.body;
  if (title && date)
    db.prepare(`INSERT INTO events (title, date, time_range, location, audience, description) VALUES (?,?,?,?,?,?)`)
      .run(title, date, time_range, location, audience, description);
  res.redirect('/admin/events');
});
app.post('/admin/events/:id/delete', requireAuth('admin'), (req, res) => {
  db.prepare(`DELETE FROM events WHERE id=?`).run(req.params.id);
  res.redirect('/admin/events');
});

/* ============ ADMIN: EXAM SCHEDULE ============ */
app.get('/admin/exams', requireAuth('admin'), (req, res) => {
  const classes = db.prepare(`SELECT DISTINCT class_name FROM students ORDER BY class_name`).all().map(r => r.class_name);
  const exams = db.prepare(`SELECT DISTINCT exam_name FROM exam_schedule ORDER BY exam_name`).all().map(r => r.exam_name);
  const exam = req.query.exam || exams[0] || 'Term 1';
  const cls = req.query.cls || classes[0] || '8-B';
  const rows = db.prepare(`SELECT * FROM exam_schedule WHERE exam_name=? AND class_name=? ORDER BY date`).all(exam, cls);
  res.render('admin/exams', { user: req.session.user, active: 'exams', rows, exam, cls, exams, classes });
});
app.post('/admin/exams', requireAuth('admin'), (req, res) => {
  const { exam_name, class_name, subject, date, time_range, room } = req.body;
  if (exam_name && class_name && subject && date)
    db.prepare(`INSERT INTO exam_schedule (exam_name, class_name, subject, date, time_range, room) VALUES (?,?,?,?,?,?)`)
      .run(exam_name, class_name, subject, date, time_range, room);
  res.redirect(`/admin/exams?exam=${encodeURIComponent(exam_name)}&cls=${encodeURIComponent(class_name)}`);
});
app.post('/admin/exams/:id/delete', requireAuth('admin'), (req, res) => {
  const row = db.prepare(`SELECT * FROM exam_schedule WHERE id=?`).get(req.params.id);
  if (row) {
    db.prepare(`DELETE FROM exam_schedule WHERE id=?`).run(req.params.id);
    res.redirect(`/admin/exams?exam=${encodeURIComponent(row.exam_name)}&cls=${encodeURIComponent(row.class_name)}`);
  } else res.redirect('/admin/exams');
});

/* ============ ADMIN: STUDENT RECORDS ============ */
app.get('/admin/records', requireAuth('admin'), (req, res) => {
  const cls = req.query.cls || 'all';
  const status = req.query.status || 'all';
  let rows = db.prepare(`
    SELECT s.*, u.name, u.email FROM students s JOIN users u ON u.id = s.user_id ORDER BY s.class_name, s.roll_no
  `).all();
  if (cls !== 'all') rows = rows.filter(r => r.class_name === cls);
  if (status !== 'all') rows = rows.filter(r => r.status === status);
  rows = rows.map(s => {
    const att = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(s.id);
    let present = 0, tot = 0;
    att.forEach(r => { if (r.status !== 'holiday') tot += r.c; if (r.status === 'present') present = r.c; });
    const feesDue = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fees WHERE student_id=? AND status='due'`).get(s.id).s;
    return { ...s, attendancePct: tot ? Math.round(present / tot * 100) : null, feesDue };
  });
  const classes = db.prepare(`SELECT DISTINCT class_name FROM students ORDER BY class_name`).all().map(r => r.class_name);
  res.render('admin/records', { user: req.session.user, active: 'records', rows, cls, status, classes });
});

app.get('/admin/students/:id', requireAuth('admin'), (req, res) => {
  const s = db.prepare(`SELECT s.*, u.name, u.email, u.phone FROM students s JOIN users u ON u.id = s.user_id WHERE s.id=?`).get(req.params.id);
  if (!s) return res.status(404).send('Student not found');
  const att = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(s.id);
  let present = 0, absent = 0, holiday = 0, tot = 0;
  att.forEach(r => {
    if (r.status === 'present') present = r.c;
    if (r.status === 'absent') absent = r.c;
    if (r.status === 'holiday') holiday = r.c;
    if (r.status !== 'holiday') tot += r.c;
  });
  const attendancePct = tot ? Math.round(present / tot * 100) : null;
  const fees = db.prepare(`SELECT * FROM fees WHERE student_id=? ORDER BY due_date`).all(s.id);
  const feesPaid = fees.filter(f => f.status === 'paid').reduce((sum, f) => sum + f.amount, 0);
  const feesDue = fees.filter(f => f.status === 'due').reduce((sum, f) => sum + f.amount, 0);
  const results = db.prepare(`SELECT * FROM results WHERE student_id=? ORDER BY exam_name, subject`).all(s.id);
  const issues = db.prepare(`
    SELECT bi.*, b.title book_title FROM book_issues bi JOIN books b ON b.id = bi.book_id
    WHERE bi.student_id=? AND bi.return_date IS NULL
  `).all(s.id);
  const leaves = db.prepare(`SELECT * FROM leave_applications WHERE user_id=? ORDER BY created_at DESC`).all(s.user_id);
  res.render('admin/student-record', { user: req.session.user, active: 'users', s, attendancePct, present, absent, holiday, fees, feesPaid, feesDue, results, issues, leaves });
});

/* ============ MOBILE APP API ============ */
const apiTokens = new Map();
function issueToken(userId) {
  const token = 'tok_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  apiTokens.set(token, { userId, exp: Date.now() + 24 * 3600 * 1000 });
  return token;
}
function apiAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const rec = token && apiTokens.get(token);
  if (!rec || rec.exp < Date.now()) return res.status(401).json({ error: 'Invalid or expired token. POST /api/auth/login to get one.' });
  const user = db.prepare(`SELECT id, name, role FROM users WHERE id=?`).get(rec.userId);
  if (!user) return res.status(401).json({ error: 'User no longer exists.' });
  req.user = user;
  next();
}
function apiErr(res, msg, status = 400) { return res.status(status).json({ error: msg }); }
function requireApiRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return apiErr(res, 'Not authorized for this role.', 403);
    next();
  };
}
function apiProfile(uid) {
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(uid);
  if (!u) return null;
  if (u.role === 'student') return { ...u, record: db.prepare(`SELECT * FROM students WHERE user_id=?`).get(uid) };
  if (u.role === 'teacher') return { ...u, record: db.prepare(`SELECT * FROM teachers WHERE user_id=?`).get(uid) };
  if (u.role === 'staff') return { ...u, record: db.prepare(`SELECT * FROM staff WHERE user_id=?`).get(uid) };
  return { ...u, record: null };
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString(), app: 'st-josephs-chandel' }));

app.get('/api/docs', (req, res) => res.render('api-docs', { user: null, active: '' }));

app.post('/api/auth/login', (req, res) => {
  const { userId, name, role } = req.body || {};
  let user = null;
  if (userId) user = db.prepare(`SELECT id, name, role FROM users WHERE id=?`).get(userId);
  else if (name && role) user = db.prepare(`SELECT id, name, role FROM users WHERE name=? AND role=?`).get(name, role);
  if (!user) return apiErr(res, 'No user found. Pass userId, or name + role.', 404);
  res.json({ token: issueToken(user.id), user: apiProfile(user.id), role: user.role });
});

app.get('/api/auth/me', apiAuth, (req, res) => res.json({ user: apiProfile(req.user.id) }));

app.get('/api/dashboard', apiAuth, (req, res) => {
  const uid = req.user.id;
  const today = app.locals.today();
  if (req.user.role === 'student') {
    const student = db.prepare(`SELECT * FROM students WHERE user_id=?`).get(uid);
    const att = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(student.id);
    let present = 0, tot = 0;
    att.forEach(r => { if (r.status !== 'holiday') tot += r.c; if (r.status === 'present') present = r.c; });
    const attendancePct = tot ? Math.round(present / tot * 100) : null;
    const hwDue = db.prepare(`SELECT COUNT(*) c FROM homework WHERE class_name=? AND (due_date IS NULL OR due_date >= ?)`).get(student.class_name, today).c;
    const lastResult = db.prepare(`SELECT AVG(marks) avgMarks FROM results WHERE student_id=?`).get(student.id);
    return res.json({
      role: 'student', attendancePct, hwDue,
      avgMarks: lastResult && lastResult.avgMarks ? Math.round(lastResult.avgMarks) : null,
      fees: db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fees WHERE student_id=? AND status='due'`).get(student.id).s,
      announcements: db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC LIMIT 3`).all()
    });
  }
  if (req.user.role === 'teacher') {
    const teacher = db.prepare(`SELECT * FROM teachers WHERE user_id=?`).get(uid);
    const myClass = teacher.class_teacher_of || null;
    const studentCount = myClass ? db.prepare(`SELECT COUNT(*) c FROM students WHERE class_name=?`).get(myClass).c : 0;
    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'short' });
    const classesToday = db.prepare(`SELECT COUNT(*) c FROM class_schedule WHERE teacher_id=? AND day=?`).get(uid, todayName).c;
    const pendingApprovals = myClass ? db.prepare(`SELECT COUNT(*) c FROM leave_applications la JOIN students s ON s.user_id=la.user_id WHERE la.role='student' AND la.status='Pending' AND s.class_name=?`).get(myClass).c : 0;
    return res.json({ role: 'teacher', myClass, studentCount, classesToday, pendingApprovals });
  }
  if (req.user.role === 'staff') {
    const todayRow = db.prepare(`SELECT * FROM staff_attendance WHERE user_id=? AND date=?`).get(uid, today);
    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'short' });
    const duty = db.prepare(`SELECT * FROM duty_schedule WHERE user_id=? AND day=?`).get(uid, todayName);
    return res.json({ role: 'staff', todayRow, duty });
  }
  const totalStudents = db.prepare(`SELECT COUNT(*) c FROM students`).get().c;
  const totalTeachers = db.prepare(`SELECT COUNT(*) c FROM teachers`).get().c;
  const totalStaff = db.prepare(`SELECT COUNT(*) c FROM staff`).get().c;
  const pendingLeaves = db.prepare(`SELECT COUNT(*) c FROM leave_applications WHERE status='Pending'`).get().c;
  const att = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE date=? GROUP BY status`).all(today);
  let present = 0, total = 0;
  att.forEach(r => { total += r.c; if (r.status === 'present') present = r.c; });
  const feesCollected = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fees WHERE status='paid' AND term LIKE 'Term%'`).get().s;
  const feesDue = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fees WHERE status='due'`).get().s;
  const books = db.prepare(`SELECT COUNT(*) c FROM books`).get().c;
  const booksIssued = db.prepare(`SELECT COUNT(*) c FROM book_issues WHERE return_date IS NULL`).get().c;
  return res.json({
    role: 'admin',
    stats: { totalStudents, totalTeachers, totalStaff, pendingLeaves, attendancePct: total ? Math.round(present / total * 100) : null, feesCollected, feesDue, books, booksIssued },
    upcomingEvents: db.prepare(`SELECT * FROM events WHERE date >= ? ORDER BY date LIMIT 3`).all(today),
    pendingLeaves: db.prepare(`SELECT la.*, u.name applicant FROM leave_applications la JOIN users u ON u.id=la.user_id WHERE la.status='Pending' ORDER BY la.created_at DESC LIMIT 5`).all()
  });
});

/* students / teachers / staff */
app.get('/api/students', apiAuth, (req, res) => {
  if (req.user.role === 'student') return apiErr(res, 'Not authorized.', 403);
  const cls = req.query.class;
  const rows = db.prepare(`
    SELECT s.*, u.name, u.email, u.phone FROM students s JOIN users u ON u.id = s.user_id
    ${cls ? 'WHERE s.class_name = ?' : ''} ORDER BY u.name
  `).all(...(cls ? [cls] : []));
  res.json({ count: rows.length, students: rows });
});

app.get('/api/students/:id', apiAuth, (req, res) => {
  if (req.user.role === 'student' && req.user.id !== req.params.id) return apiErr(res, 'Not authorized.', 403);
  const s = db.prepare(`SELECT s.*, u.name, u.email, u.phone FROM students s JOIN users u ON u.id=s.user_id WHERE s.id=?`).get(req.params.id);
  if (!s) return apiErr(res, 'Student not found', 404);
  const att = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(s.id);
  let present = 0, tot = 0;
  att.forEach(r => { if (r.status !== 'holiday') tot += r.c; if (r.status === 'present') present = r.c; });
  res.json({
    ...s,
    attendancePct: tot ? Math.round(present / tot * 100) : null,
    results: db.prepare(`SELECT * FROM results WHERE student_id=? ORDER BY exam_name, subject`).all(s.id),
    fees: db.prepare(`SELECT * FROM fees WHERE student_id=? ORDER BY due_date`).all(s.id)
  });
});

app.get('/api/teachers', apiAuth, requireApiRole('admin'), (req, res) => {
  const rows = db.prepare(`SELECT t.*, u.name, u.email, u.phone FROM teachers t JOIN users u ON u.id=t.user_id ORDER BY u.name`).all();
  res.json({ count: rows.length, teachers: rows });
});

app.get('/api/staff', apiAuth, requireApiRole('admin'), (req, res) => {
  const rows = db.prepare(`SELECT st.*, u.name, u.email, u.phone FROM staff st JOIN users u ON u.id=st.user_id ORDER BY u.name`).all();
  res.json({ count: rows.length, staff: rows });
});

/* attendance */
app.get('/api/attendance', apiAuth, (req, res) => {
  if (req.user.role === 'student') return apiErr(res, 'Use /api/my-attendance.', 403);
  const cls = req.query.class;
  const date = req.query.date || app.locals.today();
  const rows = db.prepare(`
    SELECT u.name, s.roll_no, COALESCE(a.status, 'not marked') status, a.date
    FROM students s JOIN users u ON u.id = s.user_id
    LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
    ${cls ? 'WHERE s.class_name = ?' : ''} ORDER BY s.roll_no
  `).all(date, ...(cls ? [cls] : []));
  res.json({ date, count: rows.length, records: rows });
});

app.post('/api/attendance', apiAuth, (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') return apiErr(res, 'Not authorized.', 403);
  const { cls, date, statuses } = req.body || {};
  if (!cls || !date || !statuses || typeof statuses !== 'object') return apiErr(res, 'cls, date and statuses (studentId->status map) required.');
  const upsert = db.prepare(`INSERT INTO attendance (student_id, date, status) VALUES (?,?,?) ON CONFLICT(student_id, date) DO UPDATE SET status=excluded.status`);
  let updated = 0;
  Object.keys(statuses).forEach(id => {
    const st = statuses[id];
    if (['present', 'absent', 'holiday'].includes(st)) { upsert.run(id, date, st); updated++; }
  });
  res.json({ ok: true, updated, date });
});

app.get('/api/my-attendance', apiAuth, requireApiRole('student'), (req, res) => {
  const student = db.prepare(`SELECT * FROM students WHERE user_id=?`).get(req.user.id);
  const rows = db.prepare(`SELECT date, status FROM attendance WHERE student_id=? ORDER BY date DESC LIMIT 30`).all(student.id);
  const summary = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(student.id);
  res.json({ summary, history: rows.reverse() });
});

/* fees */
app.get('/api/fees', apiAuth, (req, res) => {
  if (req.user.role === 'student') {
    const student = db.prepare(`SELECT * FROM students WHERE user_id=?`).get(req.user.id);
    const rows = db.prepare(`SELECT * FROM fees WHERE student_id=? ORDER BY due_date`).all(student.id);
    return res.json({ rows });
  }
  if (req.user.role !== 'admin') return apiErr(res, 'Not authorized.', 403);
  const filter = req.query.status;
  let q = `SELECT f.*, u.name student_name, s.class_name FROM fees f JOIN students s ON s.id=f.student_id JOIN users u ON u.id=s.user_id`;
  if (filter === 'paid' || filter === 'due') q += ` WHERE f.status='${filter}'`;
  q += ` ORDER BY f.status ASC, f.due_date ASC`;
  const rows = db.prepare(q).all();
  res.json({
    rows,
    totalCollected: db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fees WHERE status='paid'`).get().s,
    totalDue: db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fees WHERE status='due'`).get().s
  });
});

app.post('/api/fees/:id/pay', apiAuth, requireApiRole('admin'), (req, res) => {
  const row = db.prepare(`SELECT * FROM fees WHERE id=?`).get(req.params.id);
  if (!row) return apiErr(res, 'Fee record not found', 404);
  const receiptNo = 'RCT-' + Math.floor(10000 + Math.random() * 89999);
  db.prepare(`UPDATE fees SET status='paid', paid_date=?, receipt_no=? WHERE id=?`).run(app.locals.today(), receiptNo, req.params.id);
  res.json({ ok: true, receipt_no: receiptNo });
});

/* leaves */
app.get('/api/leaves', apiAuth, (req, res) => {
  if (req.user.role === 'admin') {
    const filter = req.query.status;
    let rows = db.prepare(`SELECT la.*, u.name applicant FROM leave_applications la JOIN users u ON u.id=la.user_id ORDER BY la.created_at DESC`).all();
    if (filter && filter !== 'all') rows = rows.filter(l => l.status === filter);
    return res.json({ rows });
  }
  const rows = db.prepare(`SELECT * FROM leave_applications WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id);
  res.json({ rows });
});

app.post('/api/leaves', apiAuth, (req, res) => {
  const { type, from_date, to_date, reason } = req.body || {};
  if (!type || !from_date || !to_date) return apiErr(res, 'type, from_date and to_date required.');
  db.prepare(`INSERT INTO leave_applications (user_id, role, type, from_date, to_date, reason, status) VALUES (?,?,?,?,?,?, 'Pending')`)
    .run(req.user.id, req.user.role, type, from_date, to_date, reason || '');
  res.json({ ok: true, status: 'Pending' });
});

app.post('/api/leaves/:id/decide', apiAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'teacher') return apiErr(res, 'Not authorized.', 403);
  const { status } = req.body || {};
  if (!['Approved', 'Rejected'].includes(status)) return apiErr(res, 'status must be Approved or Rejected.');
  db.prepare(`UPDATE leave_applications SET status=? WHERE id=?`).run(status, req.params.id);
  res.json({ ok: true, status });
});

/* announcements */
app.get('/api/announcements', apiAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC`).all();
  res.json({ rows });
});
app.post('/api/announcements', apiAuth, requireApiRole('admin'), (req, res) => {
  const { title, message, audience } = req.body || {};
  if (!title || !message) return apiErr(res, 'title and message required.');
  db.prepare(`INSERT INTO announcements (title, message, audience) VALUES (?,?,?)`).run(title, message, audience || 'All');
  res.json({ ok: true });
});

/* homework */
app.get('/api/homework', apiAuth, (req, res) => {
  if (req.user.role === 'teacher') {
    const rows = db.prepare(`SELECT * FROM homework WHERE posted_by=? ORDER BY id DESC`).all(req.user.id);
    return res.json({ rows });
  }
  const student = db.prepare(`SELECT * FROM students WHERE user_id=?`).get(req.user.id);
  if (!student) return apiErr(res, 'Students only.', 403);
  const rows = db.prepare(`SELECT * FROM homework WHERE class_name=? ORDER BY id DESC`).all(student.class_name);
  res.json({ rows });
});
app.post('/api/homework', apiAuth, requireApiRole('teacher'), (req, res) => {
  const teacher = db.prepare(`SELECT * FROM teachers WHERE user_id=?`).get(req.user.id);
  const { class_name, title, due_date } = req.body || {};
  if (!class_name || !title) return apiErr(res, 'class_name and title required.');
  db.prepare(`INSERT INTO homework (class_name, subject, title, due_date, posted_by) VALUES (?,?,?,?,?)`)
    .run(class_name, teacher.subject, title, due_date || null, req.user.id);
  res.json({ ok: true });
});

/* results */
app.get('/api/results', apiAuth, requireApiRole('student'), (req, res) => {
  const student = db.prepare(`SELECT * FROM students WHERE user_id=?`).get(req.user.id);
  const rows = db.prepare(`SELECT * FROM results WHERE student_id=? ORDER BY exam_name, subject`).all(student.id);
  const byExam = {};
  rows.forEach(r => { (byExam[r.exam_name] = byExam[r.exam_name] || []).push(r); });
  res.json({ rows, byExam });
});

/* schedule */
app.get('/api/schedule', apiAuth, (req, res) => {
  if (req.user.role === 'student') {
    const student = db.prepare(`SELECT * FROM students WHERE user_id=?`).get(req.user.id);
    const rows = db.prepare(`
      SELECT cs.*, u.name teacher_name FROM class_schedule cs JOIN users u ON u.id=cs.teacher_id
      WHERE cs.class_name=? ORDER BY ${DAY_ORDER}, cs.time_range
    `).all(student.class_name);
    return res.json({ rows });
  }
  if (req.user.role === 'teacher') {
    const rows = db.prepare(`SELECT * FROM class_schedule WHERE teacher_id=? ORDER BY ${DAY_ORDER}, time_range`).all(req.user.id);
    return res.json({ rows });
  }
  const rows = db.prepare(`SELECT * FROM class_schedule ORDER BY ${DAY_ORDER}, time_range`).all();
  res.json({ rows });
});

/* staff clock */
app.get('/api/staff/clock', apiAuth, requireApiRole('staff'), (req, res) => {
  const today = app.locals.today();
  res.json({ today: db.prepare(`SELECT * FROM staff_attendance WHERE user_id=? AND date=?`).get(req.user.id, today) });
});
app.post('/api/staff/clock', apiAuth, requireApiRole('staff'), (req, res) => {
  const today = app.locals.today();
  const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const existing = db.prepare(`SELECT * FROM staff_attendance WHERE user_id=? AND date=?`).get(req.user.id, today);
  if (!existing || !existing.clock_in) {
    db.prepare(`INSERT INTO staff_attendance (user_id, date, status, clock_in) VALUES (?,?,'present',?) ON CONFLICT(user_id, date) DO UPDATE SET clock_in=excluded.clock_in, status='present'`).run(req.user.id, today, now);
    return res.json({ ok: true, action: 'clock-in', time: now });
  }
  if (!existing.clock_out) {
    db.prepare(`UPDATE staff_attendance SET clock_out=? WHERE user_id=? AND date=?`).run(now, req.user.id, today);
    return res.json({ ok: true, action: 'clock-out', time: now });
  }
  res.json({ ok: false, error: 'Already clocked in and out for today.' });
});

/* library */
app.get('/api/library', apiAuth, (req, res) => {
  const books = db.prepare(`SELECT * FROM books ORDER BY title`).all();
  res.json({ count: books.length, books });
});
app.post('/api/library', apiAuth, requireApiRole('admin'), (req, res) => {
  const { title, author, isbn, category, total_copies } = req.body || {};
  if (!title) return apiErr(res, 'title required.');
  const n = Math.max(1, parseInt(total_copies, 10) || 1);
  db.prepare(`INSERT INTO books (title, author, isbn, category, total_copies, available_copies) VALUES (?,?,?,?,?,?)`).run(title, author, isbn, category, n, n);
  res.json({ ok: true });
});
app.post('/api/library/:id/issue', apiAuth, requireApiRole('admin'), (req, res) => {
  const { student_id, due_date } = req.body || {};
  const book = db.prepare(`SELECT * FROM books WHERE id=?`).get(req.params.id);
  if (!book) return apiErr(res, 'Book not found', 404);
  if (book.available_copies < 1) return apiErr(res, 'No copies available.');
  if (!student_id) return apiErr(res, 'student_id required.');
  db.prepare(`INSERT INTO book_issues (book_id, student_id, issue_date, due_date) VALUES (?,?,?,?)`).run(req.params.id, student_id, app.locals.today(), due_date || null);
  db.prepare(`UPDATE books SET available_copies = available_copies - 1 WHERE id=?`).run(req.params.id);
  res.json({ ok: true, issued_to: student_id });
});
app.post('/api/library/:id/return', apiAuth, requireApiRole('admin'), (req, res) => {
  const issue = db.prepare(`SELECT * FROM book_issues WHERE book_id=? AND return_date IS NULL ORDER BY id DESC LIMIT 1`).get(req.params.id);
  if (!issue) return apiErr(res, 'No active issue for this book.', 404);
  db.prepare(`UPDATE book_issues SET return_date=? WHERE id=?`).run(app.locals.today(), issue.id);
  db.prepare(`UPDATE books SET available_copies = available_copies + 1 WHERE id=?`).run(req.params.id);
  res.json({ ok: true, issue_id: issue.id });
});

/* events */
app.get('/api/events', apiAuth, (req, res) => {
  const today = app.locals.today();
  const upcoming = db.prepare(`SELECT * FROM events WHERE date >= ? ORDER BY date`).all(today);
  const past = db.prepare(`SELECT * FROM events WHERE date < ? ORDER BY date DESC LIMIT 5`).all(today);
  res.json({ upcoming, past });
});
app.post('/api/events', apiAuth, requireApiRole('admin'), (req, res) => {
  const { title, date, time_range, location, audience, description } = req.body || {};
  if (!title || !date) return apiErr(res, 'title and date required.');
  db.prepare(`INSERT INTO events (title, date, time_range, location, audience, description) VALUES (?,?,?,?,?,?)`).run(title, date, time_range, location, audience, description);
  res.json({ ok: true });
});

/* exam schedule */
app.get('/api/exam-schedule', apiAuth, (req, res) => {
  const { exam_name, class_name } = req.query;
  let q = `SELECT * FROM exam_schedule`;
  const conds = [];
  if (exam_name) conds.push(`exam_name = ?`);
  if (class_name) conds.push(`class_name = ?`);
  if (conds.length) q += ' WHERE ' + conds.join(' AND ');
  q += ' ORDER BY date';
  const params = [];
  if (exam_name) params.push(exam_name);
  if (class_name) params.push(class_name);
  res.json({ rows: db.prepare(q).all(...params) });
});
app.post('/api/exam-schedule', apiAuth, requireApiRole('admin'), (req, res) => {
  const { exam_name, class_name, subject, date, time_range, room } = req.body || {};
  if (!exam_name || !class_name || !subject || !date) return apiErr(res, 'exam_name, class_name, subject and date required.');
  db.prepare(`INSERT INTO exam_schedule (exam_name, class_name, subject, date, time_range, room) VALUES (?,?,?,?,?,?)`).run(exam_name, class_name, subject, date, time_range, room);
  res.json({ ok: true });
});

/* ==========================================================
   LOCAL RECORDS OFFICE — separate on-premise admin panel
   Not exposed to /api (mobile apps) — local office tooling only.
   ========================================================== */
function requireLocalAuth(req, res, next) {
  if (!req.session.localUser) return res.redirect('/local-admin/login');
  next();
}
function getLocalStudent(id) {
  return db.prepare(`SELECT s.*, u.name, u.email FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id);
}
function gradeForPct(p) { if (p >= 90) return 'A+'; if (p >= 80) return 'A'; if (p >= 70) return 'B+'; if (p >= 60) return 'B'; if (p >= 50) return 'C'; return 'C-'; }

app.get('/local-admin/login', (req, res) => {
  const users = db.prepare(`SELECT id, name FROM users WHERE role='admin' ORDER BY name`).all();
  res.render('local-admin/login', { users, error: null });
});
app.post('/local-admin/login', (req, res) => {
  const user = db.prepare(`SELECT * FROM users WHERE id=? AND role='admin'`).get(req.body.userId);
  if (!user) {
    const users = db.prepare(`SELECT id, name FROM users WHERE role='admin' ORDER BY name`).all();
    return res.render('local-admin/login', { users, error: 'Please select an administrator to continue.' });
  }
  req.session.localUser = { id: user.id, name: user.name };
  res.redirect('/local-admin');
});
app.post('/local-admin/logout', (req, res) => {
  req.session.localUser = null;
  res.redirect('/local-admin/login');
});

/* local dashboard */
app.get('/local-admin', requireLocalAuth, (req, res) => {
  const totalStudents = db.prepare(`SELECT COUNT(*) c FROM students WHERE status='active'`).get().c;
  const totalAlumni = db.prepare(`SELECT COUNT(*) c FROM students WHERE status!='active'`).get().c;
  const totalParents = db.prepare(`SELECT COUNT(*) c FROM student_parents`).get().c;
  const openIncidents = db.prepare(`SELECT COUNT(*) c FROM disciplinary_records WHERE status='Open'`).get().c;
  const byClass = db.prepare(`SELECT class_name, COUNT(*) c FROM students WHERE status='active' GROUP BY class_name ORDER BY class_name`).all();
  const today = app.locals.today();
  const todayAtt = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE date=? GROUP BY status`).all(today);
  let present = 0, tot = 0;
  todayAtt.forEach(r => { tot += r.c; if (r.status === 'present') present = r.c; });
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const dayRows = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE date=? GROUP BY status`).all(iso);
    let p = 0, t = 0;
    dayRows.forEach(r => { t += r.c; if (r.status === 'present') p = r.c; });
    last7.push({ label: d.toLocaleDateString('en-US', { weekday: 'short' }), pct: t ? Math.round(p / t * 100) : 0 });
  }
  const recentStudents = db.prepare(`SELECT s.id, s.class_name, u.name FROM students s JOIN users u ON u.id=s.user_id ORDER BY s.admission_date DESC LIMIT 5`).all();
  const recentIncidents = db.prepare(`SELECT d.*, u.name student_name FROM disciplinary_records d JOIN students s ON s.id=d.student_id JOIN users u ON u.id=s.user_id WHERE d.status='Open' ORDER BY d.date DESC LIMIT 5`).all();
  const upcomingEvents = db.prepare(`SELECT * FROM events WHERE date >= ? ORDER BY date LIMIT 3`).all(today);
  res.render('local-admin/dashboard', {
    user: req.session.localUser, active: 'dashboard',
    stats: { totalStudents, totalAlumni, totalParents, openIncidents, attendancePct: tot ? Math.round(present / tot * 100) : null, today },
    byClass, last7, recentStudents, recentIncidents, upcomingEvents
  });
});

/* register */
app.get('/local-admin/students', requireLocalAuth, (req, res) => {
  const cls = req.query.cls || 'all';
  const status = req.query.status || 'active';
  const q = (req.query.q || '').trim().toLowerCase();
  let rows = db.prepare(`SELECT s.*, u.name FROM students s JOIN users u ON u.id=s.user_id ORDER BY s.class_name, s.roll_no`).all();
  if (cls !== 'all') rows = rows.filter(r => r.class_name === cls);
  if (status !== 'all') rows = rows.filter(r => r.status === status);
  if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q));
  rows = rows.map(s => {
    const att = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(s.id);
    let present = 0, tot = 0;
    att.forEach(r => { if (r.status !== 'holiday') tot += r.c; if (r.status === 'present') present = r.c; });
    return { ...s, attendancePct: tot ? Math.round(present / tot * 100) : null };
  });
  const classes = db.prepare(`SELECT DISTINCT class_name FROM students ORDER BY class_name`).all().map(r => r.class_name);
  res.render('local-admin/students', { user: req.session.localUser, active: 'students', rows, cls, status, q, classes });
});

/* new student */
app.get('/local-admin/students/new', requireLocalAuth, (req, res) => {
  const classes = db.prepare(`SELECT name FROM classes ORDER BY name`).all().map(r => r.name);
  const classNames = db.prepare(`SELECT DISTINCT class_name FROM students ORDER BY class_name`).all().map(r => r.class_name);
  [...classNames].forEach(c => { if (!classes.includes(c)) classes.push(c); });
  res.render('local-admin/student-new', { user: req.session.localUser, classes });
});

app.post('/local-admin/students', requireLocalAuth, (req, res) => {
  const {
    name, gender, dob, roll_no, class_name, religion, nationality, language, blood_group,
    address, parent_name, parent_phone, parent_email, emergency_name, emergency_phone,
    emergency_relation, admission_date, bus_route, medical_info
  } = req.body;
  if (!name || !class_name) return res.redirect('/local-admin/students/new');
  const u = db.prepare(`INSERT INTO users (name, role, email, phone, avatar_color) VALUES (?,'student',?,?,'#8B5CF6')`)
    .run(name, `${name.toLowerCase().replace(/\s+/g, '.')}@stjosephschandel.in`, parent_phone || '');
  const studentIdNo = 'SJC-' + (admission_date ? admission_date.slice(0, 4) : new Date().getFullYear()) + '-' + String(u.lastInsertRowid).padStart(3, '0');
  const s = db.prepare(`
    INSERT INTO students (user_id, roll_no, class_name, dob, blood_group, parent_name, parent_phone, bus_route,
      gender, address, admission_date, medical_info, status, religion, nationality, language, student_id_no,
      emergency_name, emergency_phone, emergency_relation)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,?,?,?)
  `).run(
    u.lastInsertRowid, roll_no || null, class_name, dob || null, blood_group || null, parent_name || null, parent_phone || null, bus_route || null,
    gender || null, address || null, admission_date || null, medical_info || null,
    religion || null, nationality || 'Indian', language || null, studentIdNo,
    emergency_name || parent_name || null, emergency_phone || parent_phone || null, emergency_relation || null
  );
  if (parent_name) {
    db.prepare(`INSERT INTO student_parents (student_id, name, relationship, mobile, email, is_primary) VALUES (?,?,?,?,?,1)`)
      .run(s.lastInsertRowid, parent_name, emergency_relation === 'Mother' ? 'Mother' : 'Father', parent_phone, parent_email);
  }
  res.redirect('/local-admin/students/' + s.lastInsertRowid);
});

/* detail */
app.get('/local-admin/students/:id', requireLocalAuth, (req, res) => {
  const s = getLocalStudent(req.params.id);
  if (!s) return res.status(404).send('Student not found.');
  const parents = db.prepare(`SELECT * FROM student_parents WHERE student_id=? ORDER BY is_primary DESC, id`).all(s.id);
  const grades = db.prepare(`SELECT * FROM grade_history WHERE student_id=? ORDER BY year DESC, term`).all(s.id);
  const movements = db.prepare(`SELECT * FROM student_movements WHERE student_id=? ORDER BY date DESC`).all(s.id);
  const medical = db.prepare(`SELECT * FROM student_medical WHERE student_id=?`).get(s.id);
  const discipline = db.prepare(`SELECT * FROM disciplinary_records WHERE student_id=? ORDER BY date DESC`).all(s.id);
  const achievements = db.prepare(`SELECT * FROM achievements WHERE student_id=? ORDER BY date DESC`).all(s.id);
  const documents = db.prepare(`SELECT * FROM documents WHERE student_id=? ORDER BY uploaded_at DESC`).all(s.id);

  const attRows = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(s.id);
  let present = 0, absent = 0, holiday = 0, tot = 0;
  attRows.forEach(r => { if (r.status === 'present') present = r.c; if (r.status === 'absent') absent = r.c; if (r.status === 'holiday') holiday = r.c; if (r.status !== 'holiday') tot += r.c; });
  const attendancePct = tot ? Math.round(present / tot * 100) : null;
  const last30 = db.prepare(`SELECT * FROM attendance WHERE student_id=? ORDER BY date DESC LIMIT 30`).all(s.id).reverse();

  // term-wise attendance summary
  const termSummary = db.prepare(`
    SELECT a.status, COUNT(*) c FROM attendance a
    WHERE a.student_id=? AND a.date >= date('now','-180 days') GROUP BY a.status
  `).all(s.id);

  res.render('local-admin/student', {
    user: req.session.localUser, active: 'students',
    s, parents, grades, movements, medical, discipline, achievements, documents,
    attendance: { present, absent, holiday, attendancePct, last30, termSummary }
  });
});

/* edit basic details */
app.get('/local-admin/students/:id/edit', requireLocalAuth, (req, res) => {
  const s = getLocalStudent(req.params.id);
  if (!s) return res.status(404).send('Student not found.');
  res.render('local-admin/student-edit', { user: req.session.localUser, s });
});
app.post('/local-admin/students/:id/edit', requireLocalAuth, (req, res) => {
  const {
    name, gender, dob, roll_no, class_name, religion, nationality, language, blood_group,
    address, parent_name, parent_phone, bus_route, admission_date, medical_info, status
  } = req.body;
  db.prepare(`
    UPDATE students SET roll_no=?, class_name=?, dob=?, blood_group=?, parent_name=?, parent_phone=?, bus_route=?,
      gender=?, address=?, admission_date=?, medical_info=?, status=?, religion=?, nationality=?, language=?
    WHERE id=?
  `).run(roll_no || null, class_name, dob || null, blood_group || null, parent_name || null, parent_phone || null, bus_route || null,
    gender || null, address || null, admission_date || null, medical_info || null, status || 'active', religion || null, nationality || 'Indian', language || null,
    req.params.id);
  db.prepare(`UPDATE users SET name=? WHERE id=(SELECT user_id FROM students WHERE id=?)`).run(name, req.params.id);
  res.redirect('/local-admin/students/' + req.params.id);
});

/* photo upload */
app.post('/local-admin/students/:id/photo', requireLocalAuth, uploadPhoto.single('photo'), (req, res) => {
  if (req.file) db.prepare(`UPDATE students SET photo=? WHERE id=?`).run('/uploads/photos/' + req.file.filename, req.params.id);
  res.redirect('/local-admin/students/' + req.params.id);
});

/* parents */
app.post('/local-admin/students/:id/parents', requireLocalAuth, (req, res) => {
  const { name, relationship, mobile, work_phone, home_phone, email, occupation, workplace, is_primary } = req.body;
  if (name) {
    db.prepare(`INSERT INTO student_parents (student_id, name, relationship, mobile, work_phone, home_phone, email, occupation, workplace, is_primary) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(req.params.id, name, relationship, mobile, work_phone, home_phone, email, occupation, workplace, is_primary ? 1 : 0);
  }
  res.redirect('/local-admin/students/' + req.params.id + '#parents');
});
app.post('/local-admin/students/:id/parents/:pid/delete', requireLocalAuth, (req, res) => {
  db.prepare(`DELETE FROM student_parents WHERE id=? AND student_id=?`).run(req.params.pid, req.params.id);
  res.redirect('/local-admin/students/' + req.params.id + '#parents');
});

/* academic grade history */
app.post('/local-admin/students/:id/grades', requireLocalAuth, (req, res) => {
  const { year, term, class_name, percentage, rank, remarks } = req.body;
  const pct = parseInt(percentage, 10);
  if (!isNaN(pct)) {
    db.prepare(`INSERT INTO grade_history (student_id, year, term, class_name, overall_grade, percentage, rank, remarks) VALUES (?,?,?,?,?,?,?,?)`)
      .run(req.params.id, year || null, term || '', class_name || '', gradeForPct(pct), pct, rank || null, remarks || '');
  }
  res.redirect('/local-admin/students/' + req.params.id + '#academics');
});
app.post('/local-admin/students/:id/grades/:gid/delete', requireLocalAuth, (req, res) => {
  db.prepare(`DELETE FROM grade_history WHERE id=? AND student_id=?`).run(req.params.gid, req.params.id);
  res.redirect('/local-admin/students/' + req.params.id + '#academics');
});

/* promotion / transfer */
app.post('/local-admin/students/:id/move', requireLocalAuth, (req, res) => {
  const { to_class, move_type, date, remarks } = req.body;
  const s = getLocalStudent(req.params.id);
  if (s && to_class) {
    db.prepare(`INSERT INTO student_movements (student_id, from_class, to_class, move_type, date, remarks) VALUES (?,?,?,?,?,?)`)
      .run(s.id, s.class_name, to_class, move_type || 'promotion', date || app.locals.today(), remarks || '');
    db.prepare(`UPDATE students SET class_name=?, status=? WHERE id=?`).run(to_class, to_class === 'Alumni' ? 'alumni' : 'active', s.id);
  }
  res.redirect('/local-admin/students/' + req.params.id + '#academics');
});

/* medical */
app.post('/local-admin/students/:id/medical', requireLocalAuth, (req, res) => {
  const { blood_group, genotype, allergies, conditions, medications, emergency_contact, care_instructions } = req.body;
  db.prepare(`UPDATE students SET blood_group=?, medical_info=? WHERE id=?`).run(blood_group || null, care_instructions || null, req.params.id);
  db.prepare(`
    INSERT INTO student_medical (student_id, genotype, allergies, conditions, medications, emergency_contact, care_instructions)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(student_id) DO UPDATE SET
      genotype=excluded.genotype, allergies=excluded.allergies, conditions=excluded.conditions,
      medications=excluded.medications, emergency_contact=excluded.emergency_contact, care_instructions=excluded.care_instructions
  `).run(req.params.id, genotype || null, allergies || null, conditions || null, medications || null, emergency_contact || null, care_instructions || null);
  res.redirect('/local-admin/students/' + req.params.id + '#medical');
});

/* discipline */
app.post('/local-admin/students/:id/discipline', requireLocalAuth, (req, res) => {
  const { date, incident_type, description, action_taken, status, notes } = req.body;
  if (date && incident_type) {
    db.prepare(`INSERT INTO disciplinary_records (student_id, date, incident_type, description, action_taken, status, notes) VALUES (?,?,?,?,?,?,?)`)
      .run(req.params.id, date, incident_type, description || '', action_taken || '', status || 'Open', notes || '');
  }
  res.redirect('/local-admin/students/' + req.params.id + '#discipline');
});
app.post('/local-admin/students/:id/discipline/:did/delete', requireLocalAuth, (req, res) => {
  db.prepare(`DELETE FROM disciplinary_records WHERE id=? AND student_id=?`).run(req.params.did, req.params.id);
  res.redirect('/local-admin/students/' + req.params.id + '#discipline');
});

/* achievements */
app.post('/local-admin/students/:id/achievements', requireLocalAuth, (req, res) => {
  const { date, category, title, detail } = req.body;
  if (title) {
    db.prepare(`INSERT INTO achievements (student_id, date, category, title, detail) VALUES (?,?,?,?,?)`)
      .run(req.params.id, date || null, category || '', title, detail || '');
  }
  res.redirect('/local-admin/students/' + req.params.id + '#achievements');
});
app.post('/local-admin/students/:id/achievements/:aid/delete', requireLocalAuth, (req, res) => {
  db.prepare(`DELETE FROM achievements WHERE id=? AND student_id=?`).run(req.params.aid, req.params.id);
  res.redirect('/local-admin/students/' + req.params.id + '#achievements');
});

/* documents */
app.post('/local-admin/students/:id/documents', requireLocalAuth, uploadDoc.single('file'), (req, res) => {
  const { doc_type, title, notes } = req.body;
  if (title) {
    db.prepare(`INSERT INTO documents (student_id, doc_type, title, file_name, notes) VALUES (?,?,?,?,?)`)
      .run(req.params.id, doc_type || 'Other', title, req.file ? '/uploads/documents/' + req.file.filename : '', notes || '');
  }
  res.redirect('/local-admin/students/' + req.params.id + '#documents');
});
app.post('/local-admin/students/:id/documents/:docid/delete', requireLocalAuth, (req, res) => {
  db.prepare(`DELETE FROM documents WHERE id=? AND student_id=?`).run(req.params.docid, req.params.id);
  res.redirect('/local-admin/students/' + req.params.id + '#documents');
});

/* attendance remark / late */
app.post('/local-admin/students/:id/attendance', requireLocalAuth, (req, res) => {
  const { date, remark, late_minutes } = req.body;
  if (date) {
    db.prepare(`
      INSERT INTO attendance (student_id, date, status, remark, late_minutes) VALUES (?,?,?,?,?)
      ON CONFLICT(student_id, date) DO UPDATE SET remark=excluded.remark, late_minutes=excluded.late_minutes
    `).run(req.params.id, date, 'present', remark || null, parseInt(late_minutes, 10) || null);
  }
  res.redirect('/local-admin/students/' + req.params.id + '#attendance');
});

/* print view */
app.get('/local-admin/students/:id/print', requireLocalAuth, (req, res) => {
  const s = getLocalStudent(req.params.id);
  if (!s) return res.status(404).send('Student not found.');
  const parents = db.prepare(`SELECT * FROM student_parents WHERE student_id=? ORDER BY is_primary DESC, id`).all(s.id);
  const grades = db.prepare(`SELECT * FROM grade_history WHERE student_id=? ORDER BY year DESC, term`).all(s.id);
  const movements = db.prepare(`SELECT * FROM student_movements WHERE student_id=? ORDER BY date DESC`).all(s.id);
  const medical = db.prepare(`SELECT * FROM student_medical WHERE student_id=?`).get(s.id);
  const discipline = db.prepare(`SELECT * FROM disciplinary_records WHERE student_id=? ORDER BY date DESC`).all(s.id);
  const achievements = db.prepare(`SELECT * FROM achievements WHERE student_id=? ORDER BY date DESC`).all(s.id);
  const documents = db.prepare(`SELECT * FROM documents WHERE student_id=? ORDER BY uploaded_at DESC`).all(s.id);
  const attRows = db.prepare(`SELECT status, COUNT(*) c FROM attendance WHERE student_id=? GROUP BY status`).all(s.id);
  let present = 0, absent = 0, holiday = 0, tot = 0;
  attRows.forEach(r => { if (r.status === 'present') present = r.c; if (r.status === 'absent') absent = r.c; if (r.status === 'holiday') holiday = r.c; if (r.status !== 'holiday') tot += r.c; });
  const attendancePct = tot ? Math.round(present / tot * 100) : null;
  res.render('local-admin/print', {
    user: req.session.localUser, s, parents, grades, movements, medical, discipline, achievements, documents,
    attendance: { present, absent, holiday, attendancePct },
    printedAt: new Date().toLocaleString('en-IN')
  });
});

/* reports */
app.get('/local-admin/reports', requireLocalAuth, (req, res) => {
  const cls = req.query.cls || 'all';
  const classes = db.prepare(`SELECT DISTINCT class_name FROM students ORDER BY class_name`).all().map(r => r.class_name);
  const date = req.query.date || app.locals.today();

  const byClass = db.prepare(`
    SELECT s.class_name, COUNT(DISTINCT s.id) students,
      SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) present,
      SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) absent
    FROM students s LEFT JOIN attendance a ON a.student_id=s.id AND a.date=?
    GROUP BY s.class_name ORDER BY s.class_name
  `).all(date);

  const absenceReasons = db.prepare(`SELECT remark, COUNT(*) c FROM attendance WHERE status='absent' AND remark IS NOT NULL GROUP BY remark ORDER BY c DESC LIMIT 8`).all();

  const termPct = db.prepare(`
    SELECT strftime('%Y-%m', date) month, status, COUNT(*) c FROM attendance GROUP BY month, status ORDER BY month
  `).all();

  const lateCount = db.prepare(`SELECT COUNT(*) c FROM attendance WHERE late_minutes IS NOT NULL AND late_minutes > 0`).get().c;

  res.render('local-admin/reports', {
    user: req.session.localUser, active: 'reports', classes, cls, date, byClass, absenceReasons, termPct, lateCount
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`School portal running on http://localhost:${PORT}`));
