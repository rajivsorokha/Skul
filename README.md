# ST. JOSEPH'S CHANDEL — School Portal

A real Node.js/Express + SQLite web app. **All four portals — Admin, Teacher,
Student, and Staff — are fully built and share one live database.**

## Run it

```
npm install
npm start
```

Then open http://localhost:3000 — you'll land on the login page.

## Login

This is a **demo login**: pick a role, pick a name, no password needed.

- **Admin** — "Alfred Monsang"
- **Teacher** — "Mr. Ranjan Verma" for the full experience (class teacher of
  8-B, so attendance/leave-approvals/marks all have real data). Other
  teachers work too, but show empty states since they aren't assigned as a
  class teacher.
- **Student** — "Aanya Sharma" (or any of the 10 seeded 8-B students)
- **Staff** — "Ibotombi Singh" (Security Guard) for the full experience,
  including a seeded duty roster. Other staff work too, with lighter demo
  data.

## What's real here

Every page reads and writes real rows — nothing is hardcoded.

**Admin**
- **Dashboard** — live stats (students, teachers, staff, pending leaves, attendance %, fees)
- **User Management** — add/remove students, teachers, non-teaching staff
- **Attendance Reports** — per-class, per-date, with a weekly trend chart
- **Fee Management** — mark fees as paid, auto-generates a receipt number
- **Leave Management** — approve/reject student, teacher, and staff leave in one queue
- **Announcements** — broadcast a circular, see history
- **Classes & Timetable** — create classes, assign a class teacher
- **Transportation** — bus routes, drivers, assigned student counts
- **Reports & Exports** — real CSV downloads (students, fees, attendance)

**Teacher**
- **Dashboard** — classes today, students in class, pending leave requests, today's attendance %
- **Mark Attendance** — Present/Absent per student, saves to the shared attendance table
- **My Schedule** — real weekly timetable
- **Homework** — post/delete assignments
- **Exam Marks Entry** — enter marks, auto-computes grade, publishes to results
- **Student Profiles** — roster with live attendance %, click into full profile
- **Leave Approvals** — approve/reject leave from their own class's students
- **My Leave** — apply for their own leave
- **Announcements** — post to their class

**Student**
- **Dashboard** — attendance %, homework due, last exam average, today's schedule
- **Class Schedule**, **Homework**, **Study Materials**, **Exam Results** (by exam)
- **Attendance** — stats + 14-day history
- **Apply for Leave** — submit and track status
- **Notifications** — school announcements
- **My Profile**

**Staff (non-teaching)**
- **Dashboard** — Clock In/Out button (writes real timestamps), 30-day attendance stats, today's duty
- **My Attendance** — history + 14-day view
- **Leave** — all 12 leave types from the original survey, apply + history
- **Duty Schedule** — weekly roster with today highlighted
- **Staff Directory** — everyone else's contact info
- **My Profile**

## Data model

See `db.js` for the full schema: `users`, `students`, `teachers`, `staff`,
`classes`, `class_schedule`, `attendance`, `staff_attendance`, `fees`,
`leave_applications`, `announcements`, `bus_routes`, `homework`, `materials`,
`results`, `duty_schedule`.

Seed data reuses the same people throughout — Aanya Sharma, Mr. Verma,
Ibotombi Singh, Ibomcha Singh, etc. — so the whole system, across four
portals and the earlier mobile-app mockups, feels like one connected school
rather than disconnected demos.

## Next steps

- Swap the demo login for real authentication if this goes beyond a prototype
- Wire up parent-facing views (fee payment, viewing their child's data)
- Real-time notifications (websockets) instead of polling on page load
