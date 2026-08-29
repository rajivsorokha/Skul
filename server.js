const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
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

  res.render('admin/dashboard', {
    user: req.session.user, active: 'dashboard',
    stats: { totalStudents, totalTeachers, totalStaff, pendingLeaves, attendancePct, feesCollected, feesDue },
    recentAnnouncements, recentLeaves, classCounts
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`School portal running on http://localhost:${PORT}`));
