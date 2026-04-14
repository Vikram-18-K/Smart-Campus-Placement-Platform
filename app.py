from __future__ import annotations

import json
import random
import sqlite3
from pathlib import Path
from typing import Any

import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from sklearn.ensemble import RandomForestClassifier

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "placement.db"

app = Flask(__name__)
CORS(app)

model = RandomForestClassifier(n_estimators=140, random_state=42)
MODEL_READY = False


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            cgpa REAL NOT NULL,
            branch TEXT NOT NULL,
            year INTEGER NOT NULL,
            skills TEXT NOT NULL,
            dsa_rating INTEGER NOT NULL,
            projects INTEGER NOT NULL,
            certifications INTEGER NOT NULL,
            github INTEGER NOT NULL,
            aptitude_score INTEGER NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            min_cgpa REAL NOT NULL,
            required_skills TEXT NOT NULL,
            min_dsa INTEGER NOT NULL,
            min_projects INTEGER NOT NULL,
            aptitude_cutoff INTEGER NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS applications (
            student_id INTEGER NOT NULL,
            company_id INTEGER NOT NULL,
            fit_score REAL NOT NULL,
            status TEXT NOT NULL,
            reason TEXT DEFAULT '',
            PRIMARY KEY (student_id, company_id)
        )
        """
    )

    if cur.execute("SELECT COUNT(*) AS c FROM students").fetchone()["c"] == 0:
        seed_students(cur)
    if cur.execute("SELECT COUNT(*) AS c FROM companies").fetchone()["c"] == 0:
        seed_companies(cur)

    conn.commit()
    conn.close()


def seed_students(cur: sqlite3.Cursor) -> None:
    students = [
        (1, "Arjun Sharma", 9.1, "CSE", 4, "Python,DSA,ML,React,System Design", 1840, 4, 5, 88, 88),
        (2, "Priya Krishnan", 8.7, "CSE", 4, "Java,Spring,Azure,SQL,C#", 1620, 3, 4, 73, 82),
        (3, "Rohan Mehta", 7.8, "IT", 4, "React,Node.js,MongoDB,JavaScript", 1100, 3, 1, 71, 72),
        (4, "Sneha Patel", 8.2, "ECE", 4, "C++,Embedded,VLSI,Python,DSA", 980, 2, 3, 56, 79),
        (5, "Vikram Singh", 9.4, "CSE", 4, "Python,ML,AWS,DSA,Kafka,Spark", 2100, 5, 6, 94, 95),
        (6, "Ananya Reddy", 7.2, "IT", 4, "SQL,Tableau,Power BI,Excel,Analytics", 600, 1, 2, 25, 65),
        (7, "Karthik Nair", 8.9, "CSE", 4, "Go,Kubernetes,Docker,DSA,Python", 1780, 4, 4, 80, 86),
        (8, "Divya Iyer", 7.5, "Mech", 4, "CAD,MATLAB,Python,SolidWorks", 400, 2, 1, 15, 70),
        (9, "Rahul Gupta", 8.4, "CSE", 3, "Java,Android,Firebase,DSA,SQL", 1400, 3, 2, 67, 78),
        (10, "Meera Joshi", 6.9, "ECE", 4, "MATLAB,Signal Processing,C", 300, 1, 0, 10, 60),
        (11, "Aditya Bose", 9.2, "CSE", 4, "Python,FastAPI,PostgreSQL,Redis,DSA,AWS", 1950, 5, 4, 91, 91),
        (12, "Lakshmi Venkat", 7.1, "Civil", 4, "AutoCAD,Revit,STAAD Pro", 150, 1, 1, 7, 58),
    ]
    cur.executemany(
        """
        INSERT INTO students
        (id, name, cgpa, branch, year, skills, dsa_rating, projects, certifications, github, aptitude_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        students,
    )


def seed_companies(cur: sqlite3.Cursor) -> None:
    companies = [
        (1, "Google", 7.5, "Python,DSA,System Design,ML", 1200, 3, 75),
        (2, "Microsoft", 7.0, "Azure,C#,Cloud,SQL,DSA", 900, 2, 70),
        (3, "Amazon", 6.5, "Python,AWS,Spark,SQL,DSA,Kafka", 1000, 2, 65),
        (4, "Wipro", 6.0, "Java,SQL,OOPS,Testing", 450, 1, 60),
        (5, "Deloitte", 6.5, "SQL,Excel,Tableau,Analytics,Power BI", 350, 1, 65),
    ]
    cur.executemany(
        """
        INSERT INTO companies
        (id, name, min_cgpa, required_skills, min_dsa, min_projects, aptitude_cutoff)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        companies,
    )


def _skill_overlap(student_skills: str, required_skills: str) -> float:
    s = {x.strip().lower() for x in student_skills.split(",") if x.strip()}
    r = {x.strip().lower() for x in required_skills.split(",") if x.strip()}
    return (len(s & r) / len(r)) if r else 0.0


def _extract_features(student: sqlite3.Row, company: sqlite3.Row) -> list[float]:
    return [
        float(student["cgpa"]),
        float(student["dsa_rating"]),
        _skill_overlap(student["skills"], company["required_skills"]) * 100.0,
        float(student["projects"]),
        float(student["certifications"]),
        float(student["aptitude_score"]),
        float(student["github"]),
    ]


def train_model() -> None:
    global MODEL_READY
    conn = get_db()
    students = conn.execute("SELECT * FROM students").fetchall()
    companies = conn.execute("SELECT * FROM companies").fetchall()
    conn.close()

    X: list[list[float]] = []
    y: list[int] = []
    rng = random.Random(42)

    for student in students:
        for company in companies:
            f = _extract_features(student, company)
            eligibility = (
                student["cgpa"] >= company["min_cgpa"]
                and student["dsa_rating"] >= company["min_dsa"]
                and student["projects"] >= company["min_projects"]
                and student["aptitude_score"] >= company["aptitude_cutoff"]
            )
            noisy_signal = (f[0] * 7 + f[1] / 40 + f[2] + f[3] * 7 + f[4] * 5 + f[5]) / 4
            threshold = 62 + rng.uniform(-8, 8)
            y.append(1 if eligibility and noisy_signal > threshold else 0)
            X.append(f)

    model.fit(np.array(X), np.array(y))
    MODEL_READY = True


def predict_fit(student: sqlite3.Row, company: sqlite3.Row) -> dict[str, Any]:
    features = np.array([_extract_features(student, company)])
    probability = float(model.predict_proba(features)[0][1]) if MODEL_READY else 0.5
    fit_score = round(probability * 100, 2)
    skills_match = round(_skill_overlap(student["skills"], company["required_skills"]) * 100, 2)
    missing = sorted(
        list(
            {
                r.strip().lower()
                for r in company["required_skills"].split(",")
                if r.strip()
            }
            - {
                s.strip().lower()
                for s in student["skills"].split(",")
                if s.strip()
            }
        )
    )
    return {
        "fit_score": fit_score,
        "selection_probability": round(probability, 4),
        "skill_match_percent": skills_match,
        "missing_skills": missing,
    }


def rejection_reason(student: sqlite3.Row, company: sqlite3.Row) -> str:
    reasons: list[str] = []
    if student["cgpa"] < company["min_cgpa"]:
        reasons.append("Low CGPA")
    if student["dsa_rating"] < company["min_dsa"]:
        reasons.append("Low DSA rating")
    if _skill_overlap(student["skills"], company["required_skills"]) < 0.5:
        reasons.append("Skill mismatch")
    return ", ".join(reasons) if reasons else "Profile not aligned with current role demand"


@app.get("/api/students")
def get_students() -> Any:
    conn = get_db()
    rows = conn.execute("SELECT * FROM students ORDER BY id").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.get("/api/companies")
def get_companies() -> Any:
    conn = get_db()
    rows = conn.execute("SELECT * FROM companies ORDER BY id").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.post("/predict-fit-score")
def predict_fit_score() -> Any:
    payload = request.get_json(force=True)
    student_id = payload.get("student_id")
    company_id = payload.get("company_id")

    conn = get_db()
    student = conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    company = conn.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    conn.close()

    if not student or not company:
        return jsonify({"error": "student or company not found"}), 404

    result = predict_fit(student, company)
    return jsonify(result)


@app.get("/api/ranked-students/<int:company_id>")
def ranked_students(company_id: int) -> Any:
    conn = get_db()
    company = conn.execute("SELECT * FROM companies WHERE id=?", (company_id,)).fetchone()
    students = conn.execute("SELECT * FROM students").fetchall()
    if not company:
        conn.close()
        return jsonify([])

    ranked = []
    for student in students:
        prediction = predict_fit(student, company)
        ranked.append(
            {
                "student_id": student["id"],
                "name": student["name"],
                "branch": student["branch"],
                "cgpa": student["cgpa"],
                "skills": student["skills"].split(","),
                "fit_score": prediction["fit_score"],
                "selection_probability": prediction["selection_probability"],
                "skill_match_percent": prediction["skill_match_percent"],
                "missing_skills": prediction["missing_skills"],
                "resume_preview": f"{student['name']} | {student['branch']} | CGPA {student['cgpa']}",
            }
        )
    ranked.sort(key=lambda r: r["fit_score"], reverse=True)
    conn.close()
    return jsonify(ranked)


@app.post("/api/apply")
def apply_company() -> Any:
    payload = request.get_json(force=True)
    student_id = payload.get("student_id")
    company_id = payload.get("company_id")

    conn = get_db()
    student = conn.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    company = conn.execute("SELECT * FROM companies WHERE id=?", (company_id,)).fetchone()
    if not student or not company:
        conn.close()
        return jsonify({"error": "Invalid student/company"}), 400

    prediction = predict_fit(student, company)
    status = "shortlisted" if prediction["fit_score"] >= 65 else "rejected"
    reason = rejection_reason(student, company) if status == "rejected" else ""
    conn.execute(
        """
        INSERT OR REPLACE INTO applications (student_id, company_id, fit_score, status, reason)
        VALUES (?, ?, ?, ?, ?)
        """,
        (student_id, company_id, prediction["fit_score"], status, reason),
    )
    conn.commit()
    conn.close()
    return jsonify({"status": status, "fit_score": prediction["fit_score"], "feedback_reason": reason})


@app.post("/api/auto-shortlist/<int:company_id>")
def auto_shortlist(company_id: int) -> Any:
    conn = get_db()
    company = conn.execute("SELECT * FROM companies WHERE id=?", (company_id,)).fetchone()
    students = conn.execute("SELECT * FROM students").fetchall()
    if not company:
        conn.close()
        return jsonify({"shortlisted_count": 0, "eligible_students": []})

    shortlisted = []
    for student in students:
        prediction = predict_fit(student, company)
        if prediction["fit_score"] >= 70:
            shortlisted.append({"id": student["id"], "name": student["name"], "fit_score": prediction["fit_score"]})

    for row in shortlisted:
        conn.execute(
            "INSERT OR REPLACE INTO applications (student_id, company_id, fit_score, status, reason) VALUES (?, ?, ?, 'shortlisted', '')",
            (row["id"], company_id, row["fit_score"]),
        )
    conn.commit()
    conn.close()
    return jsonify({"shortlisted_count": len(shortlisted), "eligible_students": shortlisted})


@app.post("/api/schedule/auto")
def auto_schedule() -> Any:
    payload = request.get_json(silent=True) or {}
    selected = payload.get("student_ids", [1, 2, 3, 4, 5, 6])
    slots = []
    conflicts = []
    base_slots = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"]

    for idx, sid in enumerate(selected):
        slot = base_slots[idx % len(base_slots)]
        day = f"2026-04-{18 + (idx // len(base_slots)):02d}"
        if idx >= len(base_slots):
            conflicts.append({"student_id": sid, "warning": "Interview clash detected, reassigned automatically"})
        slots.append({"student_id": sid, "slot": slot, "date": day})

    return jsonify({"available_slots": slots, "conflicts": conflicts})


@app.get("/api/applications")
def get_applications() -> Any:
    conn = get_db()
    rows = conn.execute("SELECT * FROM applications").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.get("/health")
def health() -> Any:
    return jsonify({"ok": True, "model_ready": MODEL_READY, "db": str(DB_PATH)})


@app.get("/")
def serve_index() -> Any:
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/<path:filename>")
def serve_static_files(filename: str) -> Any:
    allowed = {"script.js", "styles.css"}
    if filename in allowed:
        return send_from_directory(BASE_DIR, filename)
    return jsonify({"error": "Not found"}), 404


if __name__ == "__main__":
    init_db()
    train_model()
    app.run(debug=True, port=5000)
