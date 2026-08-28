/* eslint-disable no-console */
// Realistic demo data for SARMS: University of Vavuniya, Faculty of Applied Science,
// Department of Physical Science — BSc (Hons) Information Technology & BSc (Hons) Applied
// Mathematics and Computing programmes. Walks several enrolments through every stage of the
// results lifecycle so every one of the seven roles has something to see immediately.
import { db, newId, nowIso, transaction, initDb, closeDb } from "./client";
import { hashPassword } from "../lib/auth";
import { computeM1, computeM2, computeFinalResult, DEFAULT_MARKING_SCHEME, ComponentType } from "../lib/grading";
import { recomputeGpaForStudent } from "../lib/gpaService";

const AY = "2025/2026";

async function insertUser(opts: {
  username: string;
  password: string;
  role: string;
  fullName: string;
  email: string;
  personalEmail?: string | null;
  departmentId?: string | null;
  mustChangePassword?: boolean;
}) {
  const id = newId();
  await db.prepare(
    `INSERT INTO users (id, username, password_hash, role, full_name, email, personal_email, must_change_password, active, department_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    id,
    opts.username,
    hashPassword(opts.password),
    opts.role,
    opts.fullName,
    opts.email,
    opts.personalEmail ?? null,
    opts.mustChangePassword ? 1 : 0,
    opts.departmentId ?? null,
    nowIso()
  );
  return id;
}

async function main() {
  console.log("Seeding SARMS demo data...");
  await initDb();

  await transaction(async () => {
    // --- Organisation ---------------------------------------------------------------------
    const deptId = newId();
    await db.prepare("INSERT INTO departments (id, name, faculty) VALUES (?, ?, ?)").run(
      deptId,
      "Physical Science",
      "Faculty of Applied Science"
    );

    const itProgId = newId();
    await db.prepare("INSERT INTO degree_programmes (id, name, department_id, honours_flag) VALUES (?, ?, ?, 1)").run(
      itProgId,
      "BSc (Hons) in Information Technology",
      deptId
    );
    const amcProgId = newId();
    await db.prepare("INSERT INTO degree_programmes (id, name, department_id, honours_flag) VALUES (?, ?, ?, 1)").run(
      amcProgId,
      "BSc (Hons) in Applied Mathematics and Computing",
      deptId
    );

    // --- Staff accounts ---------------------------------------------------------------------
    const superAdminId = await insertUser({
      username: "admin",
      password: "Admin@12345",
      role: "SUPER_ADMIN",
      fullName: "System Administrator",
      email: "admin@vau.ac.lk",
      // Personal/recovery email for testing the forgot-password flow — see routes/auth.ts.
      personalEmail: "jestudio22@gmail.com",
    });
    const hodId = await insertUser({
      username: "hod.physci",
      password: "Hod@12345",
      role: "HOD",
      fullName: "Dr. S. Ranatunga",
      email: "hod.physci@vau.ac.lk",
      departmentId: deptId,
    });
    const deanId = await insertUser({
      username: "dean.appsci",
      password: "Dean@12345",
      role: "DEAN",
      fullName: "Prof. K. Wijesinghe",
      email: "dean.appsci@vau.ac.lk",
      departmentId: deptId,
    });
    const chairmanId = await insertUser({
      username: "chairman.examboard",
      password: "Chairman@12345",
      role: "CHAIRMAN_EXAM_BRANCH",
      fullName: "Dr. N. Fernando",
      email: "chairman.examboard@vau.ac.lk",
    });
    const examBranchId = await insertUser({
      username: "examboard.staff",
      password: "ExamBoard@12345",
      role: "EXAMINATION_BRANCH",
      fullName: "Mrs. P. Amarasinghe",
      email: "examboard.staff@vau.ac.lk",
    });
    const lecturer1Id = await insertUser({
      username: "lecturer.perera",
      password: "Lecturer@12345",
      role: "LECTURER",
      fullName: "Mr. D. Perera",
      email: "d.perera@vau.ac.lk",
      departmentId: deptId,
    });
    await db.prepare("INSERT INTO lecturers (user_id, department_id, designation) VALUES (?, ?, ?)").run(
      lecturer1Id,
      deptId,
      "Lecturer (Probationary)"
    );
    const lecturer2Id = await insertUser({
      username: "lecturer.silva",
      password: "Lecturer@12345",
      role: "LECTURER",
      fullName: "Ms. R. Silva",
      email: "r.silva@vau.ac.lk",
      departmentId: deptId,
    });
    await db.prepare("INSERT INTO lecturers (user_id, department_id, designation) VALUES (?, ?, ?)").run(
      lecturer2Id,
      deptId,
      "Senior Lecturer"
    );

    // --- Marking scheme for this academic year (Dean/HOD-owned settings) --------------------
    await db.prepare(
      `INSERT INTO marking_schemes (id, department_id, academic_year, theory_ese_weight, theory_ica_weight,
       practical_ese_weight, practical_ica_weight, ica_best_of_count, ica_total_count, acu_min_pass_grade,
       core_min_pass_grade, language_acu_min_pass_grade, active, created_by_id, created_at)
       VALUES (?, ?, ?, 0.70, 0.30, 0.60, 0.40, 2, 3, 'D+', 'C-', 'C', 1, ?, ?)`
    ).run(newId(), deptId, AY, hodId, nowIso());

    // --- Course units -------------------------------------------------------------------------
    const courses = {
      dsa: newId(), // Data Structures & Algorithms — theory + practical, CORE
      db: newId(), // Database Systems — theory only, CORE
      swe: newId(), // Software Engineering Lab — practical only, CORE
      engl: newId(), // English Language II — ACU
    };
    await db.prepare(
      `INSERT INTO course_units (id, code, name, theory_credit, practical_credit, category, component_type, programme_id, level, semester)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(courses.dsa, "IT2032", "Data Structures & Algorithms", 2, 1, "CORE", "BOTH", itProgId, 2, 1);
    await db.prepare(
      `INSERT INTO course_units (id, code, name, theory_credit, practical_credit, category, component_type, programme_id, level, semester)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(courses.db, "IT2043", "Database Systems", 3, 0, "CORE", "THEORY_ONLY", itProgId, 2, 1);
    await db.prepare(
      `INSERT INTO course_units (id, code, name, theory_credit, practical_credit, category, component_type, programme_id, level, semester)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(courses.swe, "IT2054", "Software Engineering Lab", 0, 2, "CORE", "PRACTICAL_ONLY", itProgId, 2, 1);
    await db.prepare(
      `INSERT INTO course_units (id, code, name, theory_credit, practical_credit, category, component_type, programme_id, level, semester)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(courses.engl, "ENGL1012", "English Language II", 2, 0, "ACU", "THEORY_ONLY", itProgId, 2, 1);

    // --- Course offerings ----------------------------------------------------------------------
    const offerings = { dsa: newId(), db: newId(), swe: newId() };
    await db.prepare(
      `INSERT INTO course_offerings (id, course_id, lecturer_id, academic_year, semester, assigned_by_id, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    ).run(offerings.dsa, courses.dsa, lecturer1Id, AY, superAdminId, nowIso());
    await db.prepare(
      `INSERT INTO course_offerings (id, course_id, lecturer_id, academic_year, semester, assigned_by_id, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    ).run(offerings.db, courses.db, lecturer2Id, AY, superAdminId, nowIso());
    await db.prepare(
      `INSERT INTO course_offerings (id, course_id, lecturer_id, academic_year, semester, assigned_by_id, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    ).run(offerings.swe, courses.swe, lecturer1Id, AY, superAdminId, nowIso());

    // --- Students --------------------------------------------------------------------------------
    const studentDefs = [
      { reg: "APS/IT/2022/045", name: "Kaviya Sinnathurai", user: "kaviya.s" },
      { reg: "APS/IT/2022/046", name: "Nirosh Balachandran", user: "nirosh.b" },
      { reg: "APS/IT/2022/047", name: "Aisha Fernando", user: "aisha.f" },
      { reg: "APS/IT/2022/048", name: "Ruwan Jayasuriya", user: "ruwan.j" },
      { reg: "APS/IT/2022/049", name: "Priya Mahendran", user: "priya.m" },
      { reg: "APS/IT/2022/050", name: "Tharindu Wickramasinghe", user: "tharindu.w" },
    ];
    const studentIds: string[] = [];
    for (let i = 0; i < studentDefs.length; i++) {
      const s = studentDefs[i];
      const id = await insertUser({
        username: s.user,
        password: "Student@12345",
        role: "STUDENT",
        fullName: s.name,
        email: `${s.user}@stu.vau.ac.lk`,
        mustChangePassword: i === 0, // demonstrate the forced first-login change on one account
      });
      await db.prepare(
        "INSERT INTO students (user_id, registration_no, programme_id, level, admission_year) VALUES (?, ?, ?, 2, 2022)"
      ).run(id, s.reg, itProgId);
      studentIds.push(id);
    }

    // --- Enrollments + Result rows (ICA_OPEN) for all three offerings ----------------------------
    async function enrol(offeringId: string) {
      const enrollmentIds: string[] = [];
      for (const studentId of studentIds) {
        const enrollmentId = newId();
        await db.prepare(
          "INSERT INTO enrollments (id, student_id, offering_id, enrolled_by_id, enrolled_at) VALUES (?, ?, ?, ?, ?)"
        ).run(enrollmentId, studentId, offeringId, superAdminId, nowIso());
        const now = nowIso();
        await db.prepare(
          "INSERT INTO results (id, enrollment_id, status, created_at, updated_at) VALUES (?, ?, 'ICA_OPEN', ?, ?)"
        ).run(newId(), enrollmentId, now, now);
        enrollmentIds.push(enrollmentId);
      }
      return enrollmentIds;
    }
    const dsaEnrollments = await enrol(offerings.dsa);
    const dbEnrollments = await enrol(offerings.db);
    await enrol(offerings.swe); // left at ICA_OPEN — shows the lecturer's in-progress ICA-entry stage

    // --- ICA instruments + marks for IT2032 (Data Structures & Algorithms) -----------------------
    async function addInstrument(offeringId: string, name: string, component: "THEORY" | "PRACTICAL", maxMarks: number, seq: number) {
      const id = newId();
      await db.prepare(
        "INSERT INTO ica_instruments (id, offering_id, name, component, max_marks, sequence_no, released) VALUES (?, ?, ?, ?, ?, ?, 1)"
      ).run(id, offeringId, name, component, maxMarks, seq);
      return id;
    }
    const dsaTheoryICAs = [
      await addInstrument(offerings.dsa, "In-class Test 1", "THEORY", 20, 1),
      await addInstrument(offerings.dsa, "In-class Test 2", "THEORY", 20, 2),
      await addInstrument(offerings.dsa, "Assignment 1", "THEORY", 20, 3),
    ];
    const dsaPracticalICAs = [
      await addInstrument(offerings.dsa, "Lab Exercise 1", "PRACTICAL", 20, 1),
      await addInstrument(offerings.dsa, "Lab Exercise 2", "PRACTICAL", 20, 2),
      await addInstrument(offerings.dsa, "Lab Practical Test", "PRACTICAL", 20, 3),
    ];

    // Per-student ICA marks: student 6 (Tharindu) deliberately weak in practicals to demonstrate
    // the "lowest component grade carries forward" rule even with a strong theory mark.
    const dsaIcaTheory = [
      [18, 17, 19], [15, 14, 16], [12, 13, 11], [17, 16, 15], [10, 9, 11], [19, 18, 18],
    ];
    const dsaIcaPractical = [
      [16, 17, 15], [14, 13, 12], [10, 9, 11], [15, 14, 16], [8, 7, 9], [4, 5, 3],
    ];
    async function enterIca(instrumentIds: string[], perStudentMarks: number[][]) {
      for (let si = 0; si < studentIds.length; si++) {
        const studentId = studentIds[si];
        for (let ii = 0; ii < instrumentIds.length; ii++) {
          const instrumentId = instrumentIds[ii];
          await db.prepare(
            "INSERT INTO ica_marks (id, instrument_id, student_id, mark, entered_at) VALUES (?, ?, ?, ?, ?)"
          ).run(newId(), instrumentId, studentId, perStudentMarks[si][ii], nowIso());
        }
      }
    }
    await enterIca(dsaTheoryICAs, dsaIcaTheory);
    await enterIca(dsaPracticalICAs, dsaIcaPractical);

    // ESE marks (theory out of 100, practical out of 100) for IT2032, then submit -> HOD approve
    // -> Chairman release, so students see a released grade immediately.
    const dsaEse = [
      { theory: 78, practical: 72 },
      { theory: 62, practical: 55 },
      { theory: 48, practical: 46 },
      { theory: 70, practical: 68 },
      { theory: 38, practical: 35 },
      { theory: 82, practical: 22 }, // strong theory, failing practical -> carry-forward demo
    ];
    const course = (await db.prepare("SELECT * FROM course_units WHERE id = ?").get(courses.dsa)) as any;
    for (let i = 0; i < dsaEnrollments.length; i++) {
      const enrollmentId = dsaEnrollments[i];
      const icaTheory = dsaIcaTheory[i].map((m) => ({ mark: m, maxMarks: 20 }));
      const icaPractical = dsaIcaPractical[i].map((m) => ({ mark: m, maxMarks: 20 }));
      const m1 = computeM1(dsaEse[i].theory, icaTheory, DEFAULT_MARKING_SCHEME);
      const m2 = computeM2(dsaEse[i].practical, icaPractical, DEFAULT_MARKING_SCHEME);
      const final = computeFinalResult({
        componentType: course.component_type as ComponentType,
        m1,
        m2,
        theoryCredit: course.theory_credit,
        practicalCredit: course.practical_credit,
      });
      const now = nowIso();
      await db.prepare(
        `UPDATE results SET ese_theory=?, ese_practical=?, m1=?, m2=?, final_mark=?, grade=?, grade_point=?,
         status='HOD_APPROVED', submitted_at=?, submitted_by_id=?, hod_approved_at=?, hod_approved_by_id=?, updated_at=?
         WHERE enrollment_id = ?`
      ).run(
        dsaEse[i].theory, dsaEse[i].practical, m1, m2, final.finalMark, final.grade, final.gradePoint,
        now, lecturer1Id, now, hodId, now, enrollmentId
      );
    }

    // Release IT2032 via the Chairman -> triggers GPA/OGPA recomputation for every student.
    const dsaResultIds = (await db
      .prepare(
        `SELECT r.id, e.student_id FROM results r JOIN enrollments e ON e.id = r.enrollment_id WHERE e.offering_id = ?`
      )
      .all(offerings.dsa)) as { id: string; student_id: string }[];
    const releaseNow = nowIso();
    for (const r of dsaResultIds) {
      await db.prepare("UPDATE results SET status='RELEASED', released_at=?, released_by_id=?, updated_at=? WHERE id=?").run(
        releaseNow,
        chairmanId,
        releaseNow,
        r.id
      );
    }

    // --- IT2043 (Database Systems): submitted, awaiting HOD review — demonstrates the HOD queue ---
    const dbCourse = (await db.prepare("SELECT * FROM course_units WHERE id = ?").get(courses.db)) as any;
    const dbEse = [88, 66, 51, 74, 41, 90];
    for (let i = 0; i < dbEnrollments.length; i++) {
      const enrollmentId = dbEnrollments[i];
      const final = computeFinalResult({
        componentType: dbCourse.component_type as ComponentType,
        m1: dbEse[i],
        m2: null,
        theoryCredit: dbCourse.theory_credit,
        practicalCredit: dbCourse.practical_credit,
      });
      const now = nowIso();
      await db.prepare(
        `UPDATE results SET ese_theory=?, m1=?, final_mark=?, grade=?, grade_point=?, status='SUBMITTED',
         submitted_at=?, submitted_by_id=?, updated_at=? WHERE enrollment_id = ?`
      ).run(dbEse[i], final.finalMark, final.finalMark, final.grade, final.gradePoint, now, lecturer2Id, now, enrollmentId);
    }

    // A correction request the lecturer raised on one IT2043 result, still pending HOD decision.
    const firstDbResult = (await db.prepare("SELECT id FROM results WHERE enrollment_id = ?").get(dbEnrollments[2])) as { id: string };
    await db.prepare(
      `INSERT INTO correction_requests (id, result_id, requested_by_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?)`
    ).run(newId(), firstDbResult.id, lecturer2Id, "ESE script for this candidate was re-marked after a transcription check; final mark should be 55, not 51.", nowIso());

    // A resit attempt on record for one student (illustrative — max 2 resits / 3 attempts rule).
    await db.prepare(
      "INSERT INTO resit_attempts (id, student_id, course_id, attempt_no, grade, created_at) VALUES (?, ?, ?, 2, 'C-', ?)"
    ).run(newId(), studentIds[4], courses.engl, nowIso());
  });

  // GPA/OGPA recompute happens outside the seeding transaction (separate statements is fine).
  const released = (await db.prepare("SELECT DISTINCT e.student_id FROM results r JOIN enrollments e ON e.id = r.enrollment_id WHERE r.status='RELEASED'").all()) as { student_id: string }[];
  for (const r of released) await recomputeGpaForStudent(r.student_id);

  console.log("\nSeed complete. Demo accounts (username / password):\n");
  console.log("  Super Admin            admin / Admin@12345");
  console.log("  HOD                    hod.physci / Hod@12345");
  console.log("  Dean (view-only)       dean.appsci / Dean@12345");
  console.log("  Chairman, Exam Branch  chairman.examboard / Chairman@12345");
  console.log("  Examination Branch     examboard.staff / ExamBoard@12345");
  console.log("  Lecturer               lecturer.perera / Lecturer@12345  (IT2032, IT2054)");
  console.log("  Lecturer               lecturer.silva / Lecturer@12345   (IT2043)");
  console.log("  Student (released)     kaviya.s / Student@12345  (must change password on first login)");
  console.log("  Student                nirosh.b, aisha.f, ruwan.j, priya.m, tharindu.w / Student@12345\n");
  console.log("  Forgot-password test: try username 'admin' with personal email jestudio22@gmail.com");
  console.log("  at /forgot-password (SMTP not configured by default — the code prints here and in the API response).\n");
  await closeDb();
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
