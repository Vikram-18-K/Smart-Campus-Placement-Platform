const API_BASE = "http://127.0.0.1:5000";

let STUDENTS = [];
let COMPANIES = [];
let APPLICATIONS = [];
let filteredStudents = [];
let selectedIds = new Set();
let activeSkillFilters = [];
let backlogFilter = "any";
let internshipFilter = "any";
let projectsFilter = 0;
let yearFilter = "all";
let currentCompanyId = 1;
let darkModeEnabled = true;

const companyKeyToId = { google: 1, microsoft: 2, amazon: 3, wipro: 4, deloitte: 5 };
const companyIdToKey = { 1: "google", 2: "microsoft", 3: "amazon", 4: "wipro", 5: "deloitte" };

const COMPANY_PROFILES = {
  google: { name: "Google", cgpaMin: 7.5, requiredSkills: ["Python", "DSA", "System Design", "ML"] },
  microsoft: { name: "Microsoft", cgpaMin: 7.0, requiredSkills: ["Azure", "C#", "Cloud", "SQL", "DSA"] },
  amazon: { name: "Amazon", cgpaMin: 6.5, requiredSkills: ["Python", "AWS", "Spark", "SQL", "DSA", "Kafka"] },
  wipro: { name: "Wipro", cgpaMin: 6.0, requiredSkills: ["Java", "SQL", "OOPS", "Testing"] },
  deloitte: { name: "Deloitte", cgpaMin: 6.5, requiredSkills: ["SQL", "Excel", "Tableau", "Analytics", "Power BI"] },
};

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

function normalizeStudents(rows) {
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    roll: `ST${String(s.id).padStart(4, "0")}`,
    branch: s.branch,
    year: s.year,
    cgpa: s.cgpa,
    skills: s.skills.split(",").map((v) => v.trim()),
    dsa: s.dsa_rating,
    internship: s.projects >= 2,
    aptitude: s.aptitude_score,
    projects: s.projects,
    oss: s.github >= 50,
    certs: s.certifications >= 1,
    hackathon: s.github >= 85 && s.projects >= 3,
    backlogs: s.cgpa >= 7 ? 0 : 1,
    fitScore: 0,
    status: "applied",
    reason: "",
    fitBreakdown: null,
  }));
}

async function enrichFitScores(companyId = currentCompanyId) {
  await Promise.all(
    STUDENTS.map(async (student) => {
      const prediction = await api("/predict-fit-score", {
        method: "POST",
        body: JSON.stringify({ student_id: student.id, company_id: companyId }),
      });
      student.fitScore = Math.round(prediction.fit_score);
      student.selectionProbability = prediction.selection_probability;
      student.skillMatchPercent = prediction.skill_match_percent;
      student.missingSkills = prediction.missing_skills || [];
      student.fitBreakdown = prediction;
    }),
  );
}

async function loadData() {
  toggleLoading(true);
  try {
    const [studentsRows, companiesRows, applicationsRows] = await Promise.all([
      api("/api/students"),
      api("/api/companies"),
      api("/api/applications"),
    ]);
    COMPANIES = companiesRows;
    APPLICATIONS = applicationsRows;
    STUDENTS = normalizeStudents(studentsRows);
    hydrateApplicationStatus();
    await enrichFitScores(currentCompanyId);
    populateCompanyFilter();
    applyFilters();
    renderRecruiterPanel();
    initGuidancePage();
    renderPlacementOfficerPanel();
  } catch (error) {
    showToast("Backend unavailable. Start Flask server to load live data.", "error");
  } finally {
    toggleLoading(false);
  }
}

function hydrateApplicationStatus() {
  const map = new Map();
  APPLICATIONS.forEach((a) => map.set(`${a.student_id}-${a.company_id}`, a));
  STUDENTS.forEach((s) => {
    const app = map.get(`${s.id}-${currentCompanyId}`);
    if (app) {
      s.status = app.status;
      s.reason = app.reason || "";
      s.fitScore = Math.round(app.fit_score);
    }
  });
}

function showPage(pageId, link) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  document.getElementById("page-" + pageId).classList.add("active");
  if (link) link.classList.add("active");

  const titles = {
    dashboard: "Placement Officer Dashboard",
    students: "Recruiter Dashboard",
    companies: "Companies",
    scheduler: "Interview Scheduler",
    analytics: "Analytics",
    guidance: "Student Dashboard",
  };
  const subs = {
    dashboard: "Track eligibility and auto-shortlist operations",
    students: "Ranked students, filters, score breakdown, and actions",
    companies: "Company drives and job postings",
    scheduler: "Auto scheduling with clash detection",
    analytics: "Placement statistics and trends",
    guidance: "Personalized AI fit score and improvement plan",
  };
  document.getElementById("page-title").textContent = titles[pageId] || pageId;
  document.getElementById("page-subtitle").textContent = subs[pageId] || "";
}

async function applyFilters() {
  const cgpaMin = parseFloat(document.getElementById("cgpa-min").value);
  const cgpaMax = parseFloat(document.getElementById("cgpa-max").value);
  const fitMin = parseInt(document.getElementById("fit-score").value, 10);
  const dsaMin = parseInt(document.getElementById("dsa-rating").value, 10);
  const aptMin = parseInt(document.getElementById("aptitude").value, 10);
  const selectedBranches = Array.from(document.querySelectorAll(".branch-cb:checked")).map((cb) => cb.value);
  const company = document.getElementById("f-company").value || "google";
  const sortBy = document.getElementById("sort-by").value;
  const search = (document.getElementById("student-search").value || "").toLowerCase();
  const needOSS = document.getElementById("f-oss").checked;
  const needCert = document.getElementById("f-cert").checked;
  const needHack = document.getElementById("f-hackathon").checked;

  currentCompanyId = companyKeyToId[company] || 1;
  await enrichFitScores(currentCompanyId);

  filteredStudents = STUDENTS.filter((s) => {
    if (search && !s.name.toLowerCase().includes(search) && !s.roll.toLowerCase().includes(search)) return false;
    if (s.cgpa < cgpaMin || s.cgpa > cgpaMax) return false;
    if (selectedBranches.length > 0 && !selectedBranches.includes(s.branch)) return false;
    if (yearFilter !== "all" && String(s.year) !== yearFilter) return false;
    if (backlogFilter === "0" && s.backlogs > 0) return false;
    if (backlogFilter === "1" && s.backlogs > 1) return false;
    if (activeSkillFilters.length > 0 && !activeSkillFilters.every((f) => s.skills.some((ss) => ss.toLowerCase().includes(f)))) return false;
    if (dsaMin > 0 && s.dsa < dsaMin) return false;
    if (internshipFilter === "yes" && !s.internship) return false;
    if (internshipFilter === "no" && s.internship) return false;
    if (s.aptitude < aptMin) return false;
    if (s.projects < projectsFilter) return false;
    if (needOSS && !s.oss) return false;
    if (needCert && !s.certs) return false;
    if (needHack && !s.hackathon) return false;
    if (fitMin > 0 && s.fitScore < fitMin) return false;
    return true;
  });

  filteredStudents.sort((a, b) => {
    if (sortBy === "cgpa") return b.cgpa - a.cgpa;
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "dsa") return b.dsa - a.dsa;
    return b.fitScore - a.fitScore;
  });

  document.getElementById("filter-count").textContent = filteredStudents.length;
  renderStudentTable();
  renderRecruiterPanel();
  renderPlacementOfficerPanel();
}

function renderStudentTable() {
  const tbody = document.getElementById("student-tbody");
  const empty = document.getElementById("empty-state");
  if (!tbody) return;

  if (filteredStudents.length === 0) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  tbody.innerHTML = filteredStudents
    .map((s) => {
      const fitColor = s.fitScore >= 80 ? "#34d399" : s.fitScore >= 60 ? "#fbbf24" : "#f87171";
      const statusMap = { applied: "applied", shortlisted: "shortlisted", rejected: "rejected", interview: "interview", offer: "offer" };
      const checked = selectedIds.has(s.id) ? "checked" : "";
      const reasonTooltip = s.reason ? `title="${s.reason}"` : "";
      return `
      <tr id="row-${s.id}">
        <td><input type="checkbox" ${checked} onchange="toggleSelect(${s.id}, this)" /></td>
        <td><span class="student-name">${s.name}</span><span class="student-roll">${s.roll}</span></td>
        <td>${s.branch} / ${s.year === 4 ? "Final" : `${s.year}rd`} yr</td>
        <td><span class="cgpa-badge ${s.cgpa < 7 ? "low" : s.cgpa < 8 ? "mid" : ""}">${s.cgpa.toFixed(1)}</span></td>
        <td><div class="fit-score-bar"><div class="fit-mini-bar"><div class="fit-mini-fill" style="width:${s.fitScore}%;background:${fitColor}"></div></div><span class="fit-score-val" style="color:${fitColor}">${s.fitScore}%</span></div></td>
        <td><div class="skills-cell">${s.skills.slice(0, 3).map((sk) => `<span class="tag">${sk}</span>`).join("")}</div></td>
        <td>${s.dsa}</td>
        <td>${s.internship ? '<span class="tag green">Yes</span>' : "—"}</td>
        <td><span class="status-badge ${statusMap[s.status] || "applied"}" ${reasonTooltip}>${s.status}</span></td>
        <td><div class="row-actions"><button class="row-btn view" onclick="openStudentModal(${s.id})">View</button><button class="row-btn shortlist" onclick="quickAction(${s.id}, 'shortlist')">Apply</button><button class="row-btn reject" onclick="quickAction(${s.id}, 'reject')">Reject</button></div></td>
      </tr>`;
    })
    .join("");

  updateSelectUI();
}

function updateRange(type) {
  let min = parseFloat(document.getElementById(type + "-min").value);
  let max = parseFloat(document.getElementById(type + "-max").value);
  if (min > max) {
    document.getElementById(type + "-min").value = max;
    min = max;
  }
  document.getElementById(type + "-min-val").textContent = min.toFixed(1);
  document.getElementById(type + "-max-val").textContent = max.toFixed(1);
}

function toggleYearPill(pill) {
  pill.closest(".pill-group").querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
  pill.classList.add("active");
  yearFilter = pill.dataset.val;
  applyFilters();
}
function toggleBacklog(pill) {
  pill.closest(".pill-group").querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
  pill.classList.add("active");
  backlogFilter = pill.dataset.val;
  applyFilters();
}
function toggleInternship(pill) {
  pill.closest(".pill-group").querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
  pill.classList.add("active");
  internshipFilter = pill.dataset.val;
  applyFilters();
}
function toggleProjects(pill) {
  pill.closest(".pill-group").querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
  pill.classList.add("active");
  projectsFilter = parseInt(pill.dataset.val, 10) || 0;
  applyFilters();
}

function addSkillFilter(e) {
  if (e.key !== "Enter") return;
  const val = e.target.value.trim().toLowerCase();
  if (!val || activeSkillFilters.includes(val)) {
    e.target.value = "";
    return;
  }
  activeSkillFilters.push(val);
  e.target.value = "";
  renderSkillTags();
  applyFilters();
}
function removeSkillFilter(skill) {
  activeSkillFilters = activeSkillFilters.filter((s) => s !== skill);
  renderSkillTags();
  applyFilters();
}
function renderSkillTags() {
  document.getElementById("skill-tags").innerHTML = activeSkillFilters
    .map((s) => `<span class="skill-tag">${s} <span class="remove" onclick="removeSkillFilter('${s}')">✕</span></span>`)
    .join("");
}

function resetFilters() {
  ["cgpa-min", "cgpa-max", "fit-score", "dsa-rating", "aptitude"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = id === "cgpa-min" ? 5.0 : id === "cgpa-max" ? 10 : 0;
  });
  document.getElementById("f-company").value = "";
  document.getElementById("f-oss").checked = false;
  document.getElementById("f-cert").checked = false;
  document.getElementById("f-hackathon").checked = false;
  document.querySelectorAll(".branch-cb").forEach((cb) => {
    cb.checked = true;
  });
  document.getElementById("cgpa-min-val").textContent = "5.0";
  document.getElementById("cgpa-max-val").textContent = "10";
  document.getElementById("fit-val").textContent = "0%";
  document.getElementById("dsa-val").textContent = "Any";
  document.getElementById("apt-val").textContent = "0%";
  activeSkillFilters = [];
  renderSkillTags();
  backlogFilter = "any";
  internshipFilter = "any";
  projectsFilter = 0;
  yearFilter = "all";
  selectedIds.clear();
  applyFilters();
}

function toggleSelect(id, checkbox) {
  if (checkbox.checked) selectedIds.add(id);
  else selectedIds.delete(id);
  updateSelectUI();
}
function toggleSelectAll(cb) {
  filteredStudents.forEach((s) => (cb.checked ? selectedIds.add(s.id) : selectedIds.delete(s.id)));
  renderStudentTable();
}
function updateSelectUI() {
  const count = selectedIds.size;
  document.getElementById("bulk-actions").style.display = count > 0 ? "flex" : "none";
  document.getElementById("select-all-bar").style.display = count > 0 ? "flex" : "none";
  document.getElementById("selected-count").textContent = `${count} selected`;
}

async function quickAction(id, action) {
  const companyId = currentCompanyId;
  if (action === "shortlist") {
    const result = await api("/api/apply", {
      method: "POST",
      body: JSON.stringify({ student_id: id, company_id: companyId }),
    });
    const student = STUDENTS.find((s) => s.id === id);
    if (student) {
      student.status = result.status;
      student.reason = result.feedback_reason || "";
      student.fitScore = Math.round(result.fit_score);
    }
    showToast(result.status === "rejected" ? `Rejected: ${result.feedback_reason}` : "Applied successfully", result.status === "rejected" ? "error" : "success");
  } else {
    const student = STUDENTS.find((s) => s.id === id);
    if (student) {
      student.status = "rejected";
      student.reason = "Manual rejection";
      showToast("Student rejected", "error");
    }
  }
  applyFilters();
}

function bulkAction(action) {
  if (selectedIds.size === 0) return;
  if (action === "export") {
    exportCSV();
    return;
  }
  selectedIds.forEach((id) => quickAction(id, action === "shortlist" ? "shortlist" : "reject"));
}

function exportCSV() {
  const headers = ["Name", "Branch", "CGPA", "Fit Score", "Skills", "Status"];
  const rows = filteredStudents.map((s) => [s.name, s.branch, s.cgpa, `${s.fitScore}%`, s.skills.join("; "), s.status]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ranked_students.csv";
  a.click();
}

function openStudentModal(id) {
  const s = STUDENTS.find((x) => x.id === id);
  if (!s) return;
  const companyKey = companyIdToKey[currentCompanyId];
  const cp = COMPANY_PROFILES[companyKey];
  const missing = s.missingSkills || [];
  const suggestions = [];
  if (s.dsa < 1000) suggestions.push("Improve DSA");
  if (missing.includes("react")) suggestions.push("Learn React");
  if (s.projects < 3) suggestions.push("Build more projects");

  document.getElementById("modal-content").innerHTML = `
    <div class="modal-profile">
      <div class="modal-avatar">${s.name.split(" ").map((w) => w[0]).join("")}</div>
      <div><div class="modal-name">${s.name}</div><div class="modal-branch">${s.roll} • ${s.branch}</div></div>
      <div style="margin-left:auto;text-align:right"><div style="font-size:30px;font-weight:800">${s.fitScore}%</div><div>${cp.name} Fit Score</div></div>
    </div>
    <div class="modal-grid">
      <div class="modal-metric"><label>Skill Match</label><strong>${Math.round(s.skillMatchPercent || 0)}%</strong></div>
      <div class="modal-metric"><label>Selection Probability</label><strong>${Math.round((s.selectionProbability || 0) * 100)}%</strong></div>
      <div class="modal-metric"><label>Missing Skills</label><strong>${missing.join(", ") || "None"}</strong></div>
      <div class="modal-metric"><label>Suggestions</label><strong>${suggestions.join(", ") || "Keep momentum"}</strong></div>
    </div>
    ${
      s.status === "rejected" && s.reason
        ? `<div class="ai-feedback-box"><strong>Rejection Feedback</strong>${s.reason}</div>`
        : ""
    }
    <div class="modal-actions"><button class="btn-shortlist" onclick="quickAction(${s.id}, 'shortlist');closeModal()">Apply</button><button class="btn-reject" onclick="quickAction(${s.id}, 'reject');closeModal()">Reject</button></div>
  `;

  document.getElementById("modal-overlay").classList.add("open");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
}

function renderGuidancePage(studentId) {
  const student = STUDENTS.find((s) => s.id == studentId);
  if (!student) return;
  document.getElementById("guidance-profile").innerHTML = `
    <div class="gp-header">
      <div class="gp-avatar">${student.name.split(" ").map((w) => w[0]).join("")}</div>
      <div class="gp-info"><h2>${student.name}</h2><p>${student.branch} • Year ${student.year}</p></div>
      <div class="gp-overall"><div class="gp-score-ring"><span class="gp-score-num">${student.fitScore}%</span><span class="gp-score-lbl">AI Fit</span></div></div>
    </div>
    <div class="gp-metrics">
      <div class="gp-metric"><span>CGPA</span><strong>${student.cgpa}</strong></div>
      <div class="gp-metric"><span>DSA</span><strong>${student.dsa}</strong></div>
      <div class="gp-metric"><span>Aptitude</span><strong>${student.aptitude}%</strong></div>
    </div>`;

  const companyRows = Object.entries(companyKeyToId).map(([key, id]) => {
    const base = COMPANY_PROFILES[key];
    const match = skillMatch(student.skills, base.requiredSkills);
    const score = Math.round(student.fitScore * 0.7 + match * 0.3);
    return { name: base.name, role: "Role", score };
  });
  document.getElementById("guidance-company-scores").innerHTML = companyRows
    .map((c) => `<div class="company-fit-row"><div class="cfit-label"><span class="cfit-name">${c.name}</span><span class="cfit-role">${c.role}</span></div><div class="cfit-bar-wrap"><div class="cfit-track"><div class="cfit-fill" style="width:${c.score}%"></div></div><span class="cfit-score">${c.score}%</span></div></div>`)
    .join("");

  const missing = student.missingSkills || [];
  document.getElementById("guidance-gaps").innerHTML = missing.length
    ? missing.map((m) => `<div class="gap-item medium"><div class="gap-pill skill">SKILL</div><div class="gap-info"><strong>${m}</strong><span>Missing in target company requirements</span></div></div>`).join("")
    : '<div class="empty-guidance">No major skill gaps detected.</div>';

  const suggestions = [
    student.dsa < 1000 ? "Improve DSA daily with timed practice" : "Maintain coding rhythm",
    missing.includes("react") ? "Learn React fundamentals for frontend-heavy roles" : "Deepen strongest stack",
    student.projects < 3 ? "Build at least one full-stack project" : "Add polish and deployment links",
  ];
  document.getElementById("guidance-courses").innerHTML = suggestions
    .map((s) => `<div class="course-card"><div class="course-icon">🎯</div><div class="course-info"><strong>${s}</strong><span class="course-meta">AI Suggestion</span></div></div>`)
    .join("");

  document.getElementById("guidance-plan").innerHTML = `
    <div class="study-plan">
      <div class="study-day"><span class="day-label">Mon</span><div class="study-task">DSA + aptitude</div></div>
      <div class="study-day"><span class="day-label">Tue</span><div class="study-task">Project development</div></div>
      <div class="study-day"><span class="day-label">Wed</span><div class="study-task">Mock interview + resume update</div></div>
    </div>`;
}

function initGuidancePage() {
  const select = document.getElementById("guidance-student-select");
  if (!select) return;
  select.innerHTML = STUDENTS.map((s) => `<option value="${s.id}">${s.name} (${s.branch})</option>`).join("");
  if (STUDENTS.length) renderGuidancePage(STUDENTS[0].id);
}

function skillMatch(studentSkills, requiredSkills) {
  const s = new Set(studentSkills.map((x) => x.toLowerCase()));
  const r = requiredSkills.map((x) => x.toLowerCase());
  const hit = r.filter((x) => s.has(x)).length;
  return Math.round((hit / r.length) * 100);
}

function renderRecruiterPanel() {
  const node = document.getElementById("recruiter-insights");
  if (!node) return;
  const top = [...filteredStudents].sort((a, b) => b.fitScore - a.fitScore).slice(0, 5);
  node.innerHTML = top
    .map((s, i) => `<div class="action-item"><div class="action-icon">#${i + 1}</div><div class="action-text"><strong>${s.name}</strong><span>Fit ${s.fitScore}% • Resume: ${s.branch}, CGPA ${s.cgpa}</span></div><button class="action-btn" onclick="openStudentModal(${s.id})">Score</button></div>`)
    .join("");
}

function renderPlacementOfficerPanel() {
  const countNode = document.getElementById("eligible-student-count");
  if (!countNode) return;
  const eligible = filteredStudents.filter((s) => s.fitScore >= 70);
  countNode.textContent = String(eligible.length);
}

async function autoShortlistNow() {
  const data = await api(`/api/auto-shortlist/${currentCompanyId}`, { method: "POST" });
  showToast(`Auto-shortlisted ${data.shortlisted_count} students`, "success");
  await loadData();
}

async function autoScheduleInterviews() {
  const data = await api("/api/schedule/auto", {
    method: "POST",
    body: JSON.stringify({ student_ids: filteredStudents.slice(0, 8).map((s) => s.id) }),
  });
  const alertNode = document.getElementById("auto-scheduler-output");
  if (alertNode) {
    alertNode.innerHTML = `
      <div>${data.available_slots.map((s) => `<div>${s.student_id}: ${s.date} ${s.slot}</div>`).join("")}</div>
      <div style="margin-top:8px;color:#fbbf24">${data.conflicts.map((c) => c.warning).join("<br/>") || "No conflicts detected"}</div>
    `;
  }
}

function populateCompanyFilter() {
  const select = document.getElementById("f-company");
  if (!select) return;
  select.innerHTML = '<option value="">All Companies</option>' +
    COMPANIES.map((c) => `<option value="${companyIdToKey[c.id]}">${c.name}</option>`).join("");
}

function showToast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove("show"), 3000);
}

function toggleLoading(show) {
  const loader = document.getElementById("app-loader");
  if (loader) loader.style.display = show ? "flex" : "none";
}

function toggleDarkMode() {
  darkModeEnabled = !darkModeEnabled;
  document.body.classList.toggle("light-mode", !darkModeEnabled);
  localStorage.setItem("smartplace-dark-mode", darkModeEnabled ? "1" : "0");
}

document.addEventListener("DOMContentLoaded", async () => {
  darkModeEnabled = localStorage.getItem("smartplace-dark-mode") !== "0";
  document.body.classList.toggle("light-mode", !darkModeEnabled);
  await loadData();
});
