const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'data', 'school.db');
const isNew = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','teacher','staff','student')),
  email TEXT,
  phone TEXT,
  avatar_color TEXT DEFAULT '#8B5CF6'
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  class_teacher_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  roll_no INTEGER,
  class_name TEXT,
  dob TEXT,
  blood_group TEXT,
  parent_name TEXT,
  parent_phone TEXT,
  bus_route TEXT
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id TEXT,
  subject TEXT,
  class_teacher_of TEXT
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id TEXT,
  department TEXT,
  designation TEXT
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','absent','holiday')),
  UNIQUE(student_id, date)
);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','absent','leave')),
  clock_in TEXT,
  clock_out TEXT,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  amount INTEGER NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'due' CHECK(status IN ('due','paid')),
  paid_date TEXT,
  receipt_no TEXT
);

CREATE TABLE IF NOT EXISTS leave_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  type TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'All',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bus_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_name TEXT NOT NULL,
  bus_no TEXT,
  driver_user_id INTEGER REFERENCES users(id),
  pickup_time TEXT,
  drop_time TEXT
);

CREATE TABLE IF NOT EXISTS homework (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL,
  subject TEXT,
  title TEXT NOT NULL,
  due_date TEXT,
  posted_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  marks INTEGER,
  grade TEXT,
  UNIQUE(student_id, exam_name, subject)
);

CREATE TABLE IF NOT EXISTS class_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  time_range TEXT NOT NULL,
  class_name TEXT NOT NULL,
  subject TEXT,
  room TEXT
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL,
  subject TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'PDF',
  date_added TEXT DEFAULT (date('now')),
  posted_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS duty_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  shift_label TEXT NOT NULL,
  time_range TEXT NOT NULL,
  post TEXT
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  isbn TEXT,
  category TEXT,
  total_copies INTEGER NOT NULL DEFAULT 1,
  available_copies INTEGER NOT NULL DEFAULT 1,
  added_at TEXT DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS book_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  return_date TEXT,
  UNIQUE(book_id, student_id, return_date)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time_range TEXT,
  location TEXT,
  audience TEXT DEFAULT 'All',
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exam_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  date TEXT NOT NULL,
  time_range TEXT,
  room TEXT
);

CREATE TABLE IF NOT EXISTS student_parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT,
  mobile TEXT,
  work_phone TEXT,
  home_phone TEXT,
  email TEXT,
  occupation TEXT,
  workplace TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grade_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  year INTEGER,
  term TEXT,
  class_name TEXT,
  overall_grade TEXT,
  percentage INTEGER,
  rank INTEGER,
  remarks TEXT,
  recorded_at TEXT DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS student_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_class TEXT,
  to_class TEXT,
  move_type TEXT NOT NULL DEFAULT 'promotion',
  date TEXT NOT NULL,
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS student_medical (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  genotype TEXT,
  allergies TEXT,
  conditions TEXT,
  medications TEXT,
  emergency_contact TEXT,
  care_instructions TEXT
);

CREATE TABLE IF NOT EXISTS disciplinary_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  incident_type TEXT,
  description TEXT,
  action_taken TEXT,
  status TEXT DEFAULT 'Open',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT,
  category TEXT,
  title TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  doc_type TEXT,
  title TEXT NOT NULL,
  file_name TEXT,
  notes TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);
`);

// ---- migrations for existing databases (student records) ----
const studentColumns = ['gender', 'address', 'admission_date', 'medical_info', 'status'];
const existingStudentCols = db.prepare(`PRAGMA table_info(students)`).all().map(c => c.name);
studentColumns.forEach(col => {
  if (!existingStudentCols.includes(col)) {
    let def = 'TEXT';
    if (col === 'status') def = "TEXT NOT NULL DEFAULT 'active'";
    db.exec(`ALTER TABLE students ADD COLUMN ${col} ${def}`);
  }
});
// extended local-records columns on students
const studentRecordCols = ['religion', 'nationality', 'language', 'student_id_no', 'photo', 'emergency_name', 'emergency_phone', 'emergency_relation'];
const existingStudentCols2 = db.prepare(`PRAGMA table_info(students)`).all().map(c => c.name);
studentRecordCols.forEach(col => {
  if (!existingStudentCols2.includes(col)) db.exec(`ALTER TABLE students ADD COLUMN ${col} TEXT`);
});
// attendance remarks (absence reasons / late arrivals)
const attCols = db.prepare(`PRAGMA table_info(attendance)`).all().map(c => c.name);
if (!attCols.includes('remark')) db.exec(`ALTER TABLE attendance ADD COLUMN remark TEXT`);
if (!attCols.includes('late_minutes')) db.exec(`ALTER TABLE attendance ADD COLUMN late_minutes INTEGER`);
if (!db.prepare(`PRAGMA table_info(books)`).all().some(c => c.name === 'available_copies')) {
  db.exec(`ALTER TABLE books ADD COLUMN available_copies INTEGER NOT NULL DEFAULT 1`);
}

if (isNew) {
  console.log('Seeding fresh database...');
  const insertUser = db.prepare(`INSERT INTO users (name, role, email, phone, avatar_color) VALUES (?,?,?,?,?)`);

  const admin = insertUser.run('Alfred Monsang', 'admin', 'headmaster@stjosephschandel.in', '+91 99534 82565', '#2C3444');

  const teacherSeed = [
    ['Mr. Ranjan Verma', 'r.verma@stjosephschandel.in', '+91 98xxxx7712', '#4C8DA6', 'EMP-0142', 'Mathematics', '8-B'],
    ['Ms. Iyer', 'iyer@stjosephschandel.in', '+91 97xxxx3341', '#3FB87F', 'EMP-0118', 'Science', ''],
    ['Mrs. Fernandes', 'fernandes@stjosephschandel.in', '+91 96xxxx1120', '#FB7B4F', 'EMP-0121', 'English', ''],
    ['Mr. Rao', 'rao@stjosephschandel.in', '+91 96xxxx7723', '#8B5CF6', 'EMP-0134', 'Social Studies', ''],
    ['Mrs. Singh', 'singh@stjosephschandel.in', '+91 95xxxx8890', '#E8609C', 'EMP-0140', 'Hindi', ''],
  ];
  const teacherIds = {};
  const insertTeacher = db.prepare(`INSERT INTO teachers (user_id, employee_id, subject, class_teacher_of) VALUES (?,?,?,?)`);
  for (const [name, email, phone, color, empId, subject, classTeacherOf] of teacherSeed) {
    const u = insertUser.run(name, 'teacher', email, phone, color);
    insertTeacher.run(u.lastInsertRowid, empId, subject, classTeacherOf);
    teacherIds[name] = u.lastInsertRowid;
  }

  const staffSeed = [
    ['Ranjita Devi', 'r.devi@stjosephschandel.in', '+91 94xxxx2245', '#4C8DA6', 'EMP-0201', 'Administration', 'Admin / Office'],
    ['Ibotombi Singh', 'i.singh@stjosephschandel.in', '+91 98xxxx4467', '#64748B', 'EMP-0087', 'Security', 'Security Guard'],
    ['Ibomcha Singh', 'ibomcha@stjosephschandel.in', '+91 98xxxx1187', '#64748B', 'EMP-0099', 'Transportation', 'Bus Driver'],
    ['Nongthombam Devi', 'nurse@stjosephschandel.in', '+91 93xxxx5567', '#D6479A', 'EMP-0155', 'Health & Welfare', 'Nurse'],
    ['Sanjeeta Devi', 'housekeeping@stjosephschandel.in', '+91 92xxxx3321', '#3FB87F', 'EMP-0162', 'Facilities', 'Housekeeping'],
    ['Momon Singh', 'kitchen@stjosephschandel.in', '+91 91xxxx6689', '#FFC93C', 'EMP-0170', 'Facilities', 'Kitchen Staff'],
  ];
  const insertStaff = db.prepare(`INSERT INTO staff (user_id, employee_id, department, designation) VALUES (?,?,?,?)`);
  const staffUserIds = {};
  for (const [name, email, phone, color, empId, dept, designation] of staffSeed) {
    const u = insertUser.run(name, 'staff', email, phone, color);
    insertStaff.run(u.lastInsertRowid, empId, dept, designation);
    staffUserIds[name] = u.lastInsertRowid;
  }

  db.prepare(`INSERT INTO classes (name, class_teacher_id) VALUES (?,?)`).run('8-B', teacherIds['Mr. Ranjan Verma']);
  db.prepare(`INSERT INTO classes (name, class_teacher_id) VALUES (?,?)`).run('8-A', null);
  db.prepare(`INSERT INTO classes (name, class_teacher_id) VALUES (?,?)`).run('7-B', null);

  const studentSeed = [
    ['Aanya Sharma', 24, '2012-03-14', 'B+', 'Mrs. Sharma', '+91 98xxxx4521'],
    ['Rohan Mehta', 2, '2012-05-02', 'O+', 'Mr. Mehta', '+91 97xxxx2210'],
    ['Priya Singh', 5, '2012-01-19', 'A+', 'Mrs. Singh', '+91 96xxxx8834'],
    ['Arjun Kumar', 7, '2012-07-25', 'B-', 'Mr. Kumar', '+91 95xxxx1120'],
    ['Sneha Devi', 9, '2012-02-11', 'AB+', 'Mrs. Devi', '+91 94xxxx7765'],
    ['Karan Thapa', 11, '2012-09-03', 'O-', 'Mr. Thapa', '+91 93xxxx3398'],
    ['Meera Iyer', 14, '2012-04-27', 'A+', 'Mrs. Iyer', '+91 92xxxx5541'],
    ['Vikram Rao', 16, '2012-06-15', 'B+', 'Mr. Rao', '+91 91xxxx9982'],
    ['Divya Nair', 19, '2012-08-08', 'O+', 'Mrs. Nair', '+91 90xxxx6673'],
    ['Aditya Sharma', 22, '2012-10-30', 'A-', 'Mr. Sharma', '+91 89xxxx4456'],
  ];
  const insertStudent = db.prepare(`INSERT INTO students (user_id, roll_no, class_name, dob, blood_group, parent_name, parent_phone, bus_route) VALUES (?,?,?,?,?,?,?,?)`);
  const studentIds = {};       // students.id  — used by attendance / fees / results (tables that reference students)
  const studentUserIds = {};   // users.id     — used by leave_applications (references users generically)
  for (const [name, roll, dob, bg, parentName, parentPhone] of studentSeed) {
    const u = insertUser.run(name, 'student', `${name.toLowerCase().replace(/\s+/g,'.')}@stjosephschandel.in`, parentPhone, '#8B5CF6');
    const s = insertStudent.run(u.lastInsertRowid, roll, '8-B', dob, bg, parentName, parentPhone, 'Route 6');
    studentIds[name] = s.lastInsertRowid;
    studentUserIds[name] = u.lastInsertRowid;
  }

  // Attendance: last 14 days for each student, mostly present
  const insertAtt = db.prepare(`INSERT OR IGNORE INTO attendance (student_id, date, status) VALUES (?,?,?)`);
  const today = new Date();
  for (const sid of Object.values(studentIds)) {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const dow = d.getDay();
      let status = 'present';
      if (dow === 0) status = 'holiday';
      else if (Math.random() < 0.08) status = 'absent';
      insertAtt.run(sid, d.toISOString().slice(0,10), status);
    }
  }
  // Staff attendance similarly
  const insertStaffAtt = db.prepare(`INSERT OR IGNORE INTO staff_attendance (user_id, date, status) VALUES (?,?,?)`);
  for (const uid of Object.values(staffUserIds)) {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      let status = Math.random() < 0.06 ? 'absent' : 'present';
      insertStaffAtt.run(uid, d.toISOString().slice(0,10), status);
    }
  }

  // Fees
  const insertFee = db.prepare(`INSERT INTO fees (student_id, term, amount, due_date, status, paid_date, receipt_no) VALUES (?,?,?,?,?,?,?)`);
  let receiptCounter = 10234;
  for (const [name, sid] of Object.entries(studentIds)) {
    insertFee.run(sid, 'Admission Fee', 5000, '2026-04-02', 'paid', '2026-04-02', 'RCT-' + (receiptCounter++));
    insertFee.run(sid, 'Term 1', 18500, '2026-06-12', 'paid', '2026-06-12', 'RCT-' + (receiptCounter++));
    const dueStatus = Math.random() < 0.55 ? 'due' : 'paid';
    insertFee.run(sid, 'Term 2', 18500, '2026-08-31', dueStatus, dueStatus === 'paid' ? '2026-08-15' : null, dueStatus === 'paid' ? 'RCT-' + (receiptCounter++) : null);
  }

  // Leave applications - mix of student/teacher/staff, some pending
  const insertLeave = db.prepare(`INSERT INTO leave_applications (user_id, role, type, from_date, to_date, reason, status) VALUES (?,?,?,?,?,?,?)`);
  insertLeave.run(studentUserIds['Aanya Sharma'], 'student', 'Sick Leave', '2026-08-05', '2026-08-06', 'Fever', 'Approved');
  insertLeave.run(studentUserIds['Rohan Mehta'], 'student', 'Family / Personal', '2026-08-20', '2026-08-20', 'Family function', 'Pending');
  insertLeave.run(studentUserIds['Karan Thapa'], 'student', 'Sick Leave', '2026-08-19', '2026-08-20', 'Viral fever', 'Pending');
  insertLeave.run(studentUserIds['Divya Nair'], 'student', 'Vacation', '2026-09-01', '2026-09-03', 'Travelling with family', 'Pending');
  insertLeave.run(teacherIds['Mr. Ranjan Verma'], 'teacher', 'Casual Leave', '2026-07-12', '2026-07-12', 'Personal work', 'Approved');
  insertLeave.run(staffUserIds['Ibotombi Singh'], 'staff', 'Casual Leave', '2026-07-14', '2026-07-14', 'Personal work', 'Approved');
  insertLeave.run(staffUserIds['Ibotombi Singh'], 'staff', 'Sick Leave', '2026-08-02', '2026-08-03', 'Fever', 'Approved');
  insertLeave.run(staffUserIds['Momon Singh'], 'staff', 'Emergency Leave', '2026-08-21', '2026-08-22', 'Family emergency', 'Pending');

  // Announcements
  const insertAnn = db.prepare(`INSERT INTO announcements (title, message, audience) VALUES (?,?,?)`);
  insertAnn.run('Half-Yearly results published', 'Half Yearly exam results are now available to view for all classes.', 'All Parents & Students');
  insertAnn.run('Fee reminder', 'Term 2 fee is due by 31 Aug 2026. Please pay via the parent portal.', 'All Parents');
  insertAnn.run('Independence Day circular', 'School will remain closed on 15 Aug for the national holiday.', 'All');
  insertAnn.run('Staff meeting Monday', 'All staff meeting on Monday 9:00 AM in the staff room before classes begin.', 'All Staff');

  // Bus routes
  db.prepare(`INSERT INTO bus_routes (route_name, bus_no, driver_user_id, pickup_time, drop_time) VALUES (?,?,?,?,?)`)
    .run('Route 6', 'MN-07-3345', staffUserIds['Ibomcha Singh'], '7:15 AM', '2:45 PM');

  // Homework
  const insertHw = db.prepare(`INSERT INTO homework (class_name, subject, title, due_date, posted_by) VALUES (?,?,?,?,?)`);
  insertHw.run('8-B', 'Mathematics', 'Exercise 7.3 — Quadratic Equations', '2026-08-22', teacherIds['Mr. Ranjan Verma']);
  insertHw.run('8-B', 'Science', 'Lab report: Photosynthesis experiment', '2026-08-23', teacherIds['Ms. Iyer']);
  insertHw.run('8-B', 'English', "Essay — 'A Journey I Remember'", '2026-08-25', teacherIds['Mrs. Fernandes']);

  // Results
  const insertResult = db.prepare(`INSERT INTO results (student_id, exam_name, subject, marks, grade) VALUES (?,?,?,?,?)`);
  const subjects = ['Mathematics','Science','English','Hindi','Social Studies','Computer Science'];
  function gradeFor(m){ if(m>=90) return 'A+'; if(m>=80) return 'A'; if(m>=70) return 'B+'; if(m>=60) return 'B'; if(m>=50) return 'C'; return 'C-'; }
  for (const sid of Object.values(studentIds)) {
    for (const subj of subjects) {
      const marks = 55 + Math.floor(Math.random()*40);
      insertResult.run(sid, 'Half Yearly', subj, marks, gradeFor(marks));
    }
  }

  // Class schedule for 8-B across all 5 seeded subject teachers
  const insertSchedule = db.prepare(`INSERT INTO class_schedule (teacher_id, day, time_range, class_name, subject, room) VALUES (?,?,?,?,?,?)`);
  const teacherBySubject = {
    'Mathematics': teacherIds['Mr. Ranjan Verma'],
    'Science': teacherIds['Ms. Iyer'],
    'English': teacherIds['Mrs. Fernandes'],
    'Social Studies': teacherIds['Mr. Rao'],
    'Hindi': teacherIds['Mrs. Singh'],
  };
  const scheduleSeed = [
    ['Mon','8:00 – 8:45','Mathematics'], ['Mon','8:45 – 9:30','Science'], ['Mon','9:30 – 10:15','English'],
    ['Mon','10:35 – 11:20','Social Studies'], ['Mon','11:20 – 12:05','Hindi'],
    ['Tue','8:00 – 8:45','Science'], ['Tue','8:45 – 9:30','Mathematics'], ['Tue','9:30 – 10:15','English'],
    ['Tue','10:35 – 11:20','Social Studies'],
    ['Wed','8:00 – 8:45','Hindi'], ['Wed','8:45 – 9:30','Mathematics'], ['Wed','9:30 – 10:15','Science'],
    ['Wed','11:20 – 12:05','English'], ['Wed','1:00 – 1:45','Social Studies'],
    ['Thu','8:00 – 8:45','English'], ['Thu','8:45 – 9:30','Social Studies'], ['Thu','9:30 – 10:15','Mathematics'],
    ['Thu','10:35 – 11:20','Science'], ['Thu','1:00 – 1:45','Hindi'],
    ['Fri','8:45 – 9:30','English'], ['Fri','9:30 – 10:15','Hindi'], ['Fri','10:35 – 11:20','Mathematics'],
    ['Fri','1:00 – 1:45','Science'],
  ];
  for (const [day, time_range, subject] of scheduleSeed) {
    insertSchedule.run(teacherBySubject[subject], day, time_range, '8-B', subject, '204');
  }

  // Study materials
  const insertMaterial = db.prepare(`INSERT INTO materials (class_name, subject, title, type, date_added, posted_by) VALUES (?,?,?,?,?,?)`);
  insertMaterial.run('8-B', 'Mathematics', 'Chapter 7 — Quadratic Equations (notes)', 'PDF', '2026-08-18', teacherIds['Mr. Ranjan Verma']);
  insertMaterial.run('8-B', 'Science', 'Photosynthesis — animated explainer', 'Video', '2026-08-17', teacherIds['Ms. Iyer']);
  insertMaterial.run('8-B', 'English', 'Grammar reference — Tenses', 'PDF', '2026-08-14', teacherIds['Mrs. Fernandes']);
  insertMaterial.run('8-B', 'Social Studies', 'NCERT atlas — online map tool', 'Link', '2026-08-12', teacherIds['Mr. Rao']);
  insertMaterial.run('8-B', 'Hindi', 'व्याकरण — संधि एवं समास', 'PDF', '2026-08-10', teacherIds['Mrs. Singh']);

  // Duty schedule for non-teaching staff (security guard demo persona)
  const insertDuty = db.prepare(`INSERT INTO duty_schedule (user_id, day, shift_label, time_range, post) VALUES (?,?,?,?,?)`);
  const ibotombiId = staffUserIds['Ibotombi Singh'];
  const dutySeed = [
    ['Mon','Morning','6:00 AM – 2:00 PM','Main Gate'], ['Tue','Morning','6:00 AM – 2:00 PM','Main Gate'],
    ['Wed','Morning','6:00 AM – 2:00 PM','Main Gate'], ['Thu','Evening','2:00 PM – 10:00 PM','Back Gate'],
    ['Fri','Evening','2:00 PM – 10:00 PM','Back Gate'], ['Sat','Morning','6:00 AM – 2:00 PM','Patrol'],
    ['Sun','Off Day','—','—'],
  ];
  for (const [day, shift_label, time_range, post] of dutySeed) {
    insertDuty.run(ibotombiId, day, shift_label, time_range, post);
  }

  console.log('Seed complete.');
}

// ---- ERP + student-record seed (runs on existing databases too, only when empty) ----
const seedERP = () => {
  const bookCount = db.prepare(`SELECT COUNT(*) c FROM books`).get().c;
  if (bookCount === 0) {
    const insertBook = db.prepare(`INSERT INTO books (title, author, isbn, category, total_copies, available_copies) VALUES (?,?,?,?,?,?)`);
    const booksSeed = [
      ['The Diary of a Young Girl', 'Anne Frank', '9788172344799', 'Autobiography', 3, 3],
      ['Wings of Fire', 'A.P.J. Abdul Kalam', '9788173711466', 'Autobiography', 2, 2],
      ['A Brief History of Time', 'Stephen Hawking', '9780553380163', 'Science', 2, 1],
      ['Gulliver\'s Travels', 'Jonathan Swift', '9780140620937', 'Classic', 4, 4],
      ['Panchatantra Stories', 'Vishnu Sharma', '9788172864286', 'Moral Stories', 5, 5],
      ['Harry Potter and the Philosopher\'s Stone', 'J.K. Rowling', '9780747532699', 'Fantasy', 3, 2],
      ['Tom Sawyer', 'Mark Twain', '9780140620159', 'Classic', 2, 2],
      ['Black Beauty', 'Anna Sewell', '9780140366842', 'Classic', 2, 1],
    ];
    booksSeed.forEach(([title, author, isbn, category, total, avail]) =>
      insertBook.run(title, author, isbn, category, total, avail));
  }

  const eventCount = db.prepare(`SELECT COUNT(*) c FROM events`).get().c;
  if (eventCount === 0) {
    const insertEvent = db.prepare(`INSERT INTO events (title, date, time_range, location, audience, description) VALUES (?,?,?,?,?,?)`);
    const eventsSeed = [
      ['Independence Day Celebration', '2026-08-15', '8:00 AM – 9:30 AM', 'School Ground', 'All', 'Flag hoisting followed by cultural programme.'],
      ['Parent-Teacher Meeting', '2026-09-05', '10:00 AM – 1:00 PM', 'Main Hall', 'All Parents', 'Meet class teachers to discuss student progress for Term 1.'],
      ['Annual Sports Day', '2026-11-20', '9:00 AM – 4:00 PM', 'Sports Field', 'All', 'Inter-house athletics and games.'],
      ['Science Exhibition', '2026-10-09', '10:00 AM – 2:00 PM', 'Science Block', 'Students', 'Class 6-10 science projects on display.'],
      ['Staff Development Workshop', '2026-09-18', '2:00 PM – 5:00 PM', 'Staff Room', 'All Staff', 'Workshop on new teaching methodologies.'],
    ];
    eventsSeed.forEach(e => insertEvent.run(...e));
  }

  const examCount = db.prepare(`SELECT COUNT(*) c FROM exam_schedule`).get().c;
  if (examCount === 0) {
    const insertExam = db.prepare(`INSERT INTO exam_schedule (exam_name, class_name, subject, date, time_range, room) VALUES (?,?,?,?,?,?)`);
    const examsSeed = [
      ['Term 1', '8-B', 'Mathematics', '2026-09-08', '8:00 AM – 11:00 AM', 'Hall 1'],
      ['Term 1', '8-B', 'Science', '2026-09-10', '8:00 AM – 11:00 AM', 'Hall 1'],
      ['Term 1', '8-B', 'English', '2026-09-12', '8:00 AM – 11:00 AM', 'Hall 2'],
      ['Term 1', '8-B', 'Social Studies', '2026-09-14', '8:00 AM – 11:00 AM', 'Hall 2'],
      ['Term 1', '8-B', 'Hindi', '2026-09-16', '8:00 AM – 10:00 AM', 'Hall 3'],
      ['Term 1', '8-B', 'Computer Science', '2026-09-18', '8:00 AM – 10:00 AM', 'Computer Lab'],
    ];
    examsSeed.forEach(e => insertExam.run(...e));
  }

  const recordCount = db.prepare(`SELECT COUNT(*) c FROM students WHERE admission_date IS NOT NULL`).get().c;
  if (recordCount === 0) {
    const students = db.prepare(`SELECT s.id FROM students s`).all();
    const update = db.prepare(`UPDATE students SET gender=?, address=?, admission_date=?, medical_info=?, status='active' WHERE id=?`);
    const genders = ['F', 'M', 'F', 'M', 'F', 'M', 'F', 'M', 'F', 'M'];
    students.forEach((s, i) => {
      update.run(
        genders[i % genders.length],
        `${Math.floor(100 + Math.random() * 800)} Lamka Road, Chandel`,
        `${2019 + (i % 3)}-04-0${1 + (i % 8)}`,
        'None',
        s.id
      );
    });
  }
};
seedERP();

// ---- Local Records Office seed (separate on-premise panel, runs when tables are empty) ----
const seedLocalRecords = () => {
  const students = db.prepare(`
    SELECT s.*, u.name FROM students s JOIN users u ON u.id = s.user_id ORDER BY s.id
  `).all();

  const needBasic = db.prepare(`SELECT COUNT(*) c FROM students WHERE student_id_no IS NULL`).get().c;
  if (needBasic > 0) {
    const rels = ['Christian', 'Hindu', 'Christian', 'Hindu', 'Muslim', 'Hindu', 'Hindu', 'Christian', 'Hindu', 'Christian'];
    const langs = ['Tankhul', 'Thadou', 'Vaiphei', 'Hindi', 'Meitei', 'Nepali', 'Tamil', 'English', 'Mizo', 'Paite'];
    const emRel = ['Mother', 'Father', 'Mother', 'Father', 'Mother', 'Father', 'Mother', 'Father', 'Mother', 'Father'];
    students.forEach((s, i) => {
      db.prepare(`
        UPDATE students SET religion=?, nationality='Indian', language=?, student_id_no=?,
          emergency_name=?, emergency_phone=?, emergency_relation=?, medical_info=COALESCE(medical_info,'None')
        WHERE id=?
      `).run(
        rels[i % rels.length], langs[i % langs.length],
        'SJC-' + String(2026 - (s.admission_date ? parseInt(s.admission_date.slice(0, 4), 10) : 2024)) + '-' + String(i + 1).padStart(3, '0'),
        s.parent_name || s.name + "'s Guardian", s.parent_phone || '', emRel[i % emRel.length],
        s.id
      );
    });
  }

  const parentCount = db.prepare(`SELECT COUNT(*) c FROM student_parents`).get().c;
  if (parentCount === 0) {
    const insertP = db.prepare(`INSERT INTO student_parents (student_id, name, relationship, mobile, home_phone, email, occupation, workplace, is_primary) VALUES (?,?,?,?,?,?,?,?,1)`);
    const occupations = ['Government Teacher', 'Business Owner', 'Homemaker', 'Bank Officer', 'Farmer', 'Nurse'];
    students.forEach((s, i) => {
      insertP.run(s.id, s.parent_name || 'Guardian', s.emergency_relation === 'Mother' ? 'Mother' : 'Father', s.parent_phone || '', '',
        `${(s.name.split(' ')[0]).toLowerCase()}@gmail.com`, occupations[i % occupations.length], 'Chandel, Manipur');
    });
  }

  const gradeCount = db.prepare(`SELECT COUNT(*) c FROM grade_history`).get().c;
  if (gradeCount === 0) {
    const insertG = db.prepare(`INSERT INTO grade_history (student_id, year, term, class_name, overall_grade, percentage, rank, remarks) VALUES (?,?,?,?,?,?,?,?)`);
    students.forEach(s => {
      const avg = db.prepare(`SELECT AVG(marks) a FROM results WHERE student_id=?`).get(s.id).a;
      const pct = avg ? Math.round(avg) : 65 + Math.floor(Math.random() * 25);
      const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B+' : pct >= 60 ? 'B' : 'C';
      const rank = 1 + Math.floor(Math.random() * 8);
      insertG.run(s.id, 2025, 'Term 2', '7-A', grade, pct, rank, 'Promoted on merit.');
      insertG.run(s.id, 2024, 'Annual', '6-B', grade, pct - 3, rank + 2, '');
    });
  }

  const moveCount = db.prepare(`SELECT COUNT(*) c FROM student_movements`).get().c;
  if (moveCount === 0) {
    const insertM = db.prepare(`INSERT INTO student_movements (student_id, from_class, to_class, move_type, date, remarks) VALUES (?,?,?,?,?,?)`);
    students.forEach(s => {
      insertM.run(s.id, '7-A', s.class_name, 'promotion', (s.admission_date || '2025-04-01'), 'Year-end promotion.');
    });
  }

  const medCount = db.prepare(`SELECT COUNT(*) c FROM student_medical`).get().c;
  if (medCount === 0) {
    const insertM = db.prepare(`INSERT INTO student_medical (student_id, genotype, allergies, conditions, medications, emergency_contact, care_instructions) VALUES (?,?,?,?,?,?,?)`);
    const genotypes = ['AA', 'AS', 'AA', 'AA', 'AS', 'AA', 'AA', 'AA', 'AS', 'AA'];
    students.forEach((s, i) => {
      insertM.run(s.id, genotypes[i % genotypes.length], i % 3 === 0 ? 'Dust pollen' : 'None', i % 4 === 0 ? 'Mild asthma' : 'None', i % 5 === 0 ? 'Inhaler (as needed)' : 'None', `${s.parent_name} — ${s.parent_phone}`, 'Notify parents immediately in case of fever above 100F.');
    });
  }

  const discCount = db.prepare(`SELECT COUNT(*) c FROM disciplinary_records`).get().c;
  if (discCount === 0) {
    const insertD = db.prepare(`INSERT INTO disciplinary_records (student_id, date, incident_type, description, action_taken, status, notes) VALUES (?,?,?,?,?,?,?)`);
    const seedDisc = [
      ['Late to class', 'Arrived 15 minutes late without a pass.', 'Verbal warning.', 'Closed', 'Discussed with parent over phone.'],
      ['Class participation', 'Actively led the science group project.', 'Positive — commended in assembly.', 'Closed', 'Recognized by the Headmistress.'],
    ];
    students.forEach((s, i) => {
      if (i % 3 === 0) insertD.run(s.id, '2026-07-15', seedDisc[0][0], seedDisc[0][1], seedDisc[0][2], seedDisc[0][3], seedDisc[0][4]);
      if (i % 4 === 1) insertD.run(s.id, '2026-08-10', seedDisc[1][0], seedDisc[1][1], seedDisc[1][2], seedDisc[1][3], seedDisc[1][4]);
    });
  }

  const achCount = db.prepare(`SELECT COUNT(*) c FROM achievements`).get().c;
  if (achCount === 0) {
    const insertA = db.prepare(`INSERT INTO achievements (student_id, date, category, title, detail) VALUES (?,?,?,?,?)`);
    const seedAch = [
      ['Academic', 'First in Class — Mathematics', 'Scored the highest marks in Half Yearly.'],
      ['Sports', 'Inter-School Football Runners-Up', 'Member of the school team, district level.'],
      ['Arts', 'District Painting Competition Winner', 'First prize in the senior category.'],
      ['Leadership', 'Class Monitor', 'Elected by classmates for Term 2.'],
      ['Extra-curricular', 'Quiz Club Member', 'Represented the school in the state quiz.'],
    ];
    students.forEach((s, i) => {
      insertA.run(s.id, '2026-08-18', seedAch[i % 5][0], seedAch[i % 5][1], seedAch[i % 5][2]);
    });
  }

  const docCount = db.prepare(`SELECT COUNT(*) c FROM documents`).get().c;
  if (docCount === 0) {
    const insertDoc = db.prepare(`INSERT INTO documents (student_id, doc_type, title, file_name, notes) VALUES (?,?,?,?,?)`);
    students.forEach(s => {
      insertDoc.run(s.id, 'Birth Certificate', 'Birth Certificate', '', 'Verified against original.');
      insertDoc.run(s.id, 'Previous School', 'Transcript — Class 7', '', 'Received from previous school.');
      insertDoc.run(s.id, 'Medical', 'Immunization Record', '', 'Copy on file.');
      insertDoc.run(s.id, 'Admission Form', 'Admission Form 2026', '', 'Signed by parent.');
      insertDoc.run(s.id, 'Consent Form', 'Parent Consent Form', '', 'Field trip + media consent.');
    });
  }

  const remarkCount = db.prepare(`SELECT COUNT(*) c FROM attendance WHERE status='absent' AND remark IS NOT NULL`).get().c;
  if (remarkCount === 0) {
    const absents = db.prepare(`SELECT id FROM attendance WHERE status='absent' ORDER BY id LIMIT 12`).all();
    const reasons = ['Fever', 'Family function', 'Travel', 'Doctor appointment', 'Personal', 'Weather'];
    absents.forEach((a, i) => {
      db.prepare(`UPDATE attendance SET remark=? WHERE id=?`).run(reasons[i % reasons.length], a.id);
    });
  }
};
seedLocalRecords();

module.exports = db;
