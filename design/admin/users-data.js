/* Local mock data only. Replace this adapter with backend calls later. */
(function (root) {
  "use strict";
  const KEY = "study-admin-users-v1";
  const NOW = "2026-10-10T10:42:00+02:00";
  const people = [
    [
      "lena",
      "Lena Fischer",
      "D-ITET",
      2200,
      22,
      2,
      0,
      "occupied",
      "HG E 1.1",
      1,
    ],
    ["tim", "Tim Vogt", "D-INFK", 1455, 16, 1, 1, "reserved", "HG E 1.1", 3],
    ["maya", "Maya Keller", "D-ARCH", 2890, 28, 2, 1, "break", "HCI G 3", 2],
    ["jonas", "Jonas Meier", "D-MATH", 990, 10, 1, 1, null, null, null],
    [
      "nora",
      "Nora Baumann",
      "D-PHYS",
      2525,
      24,
      2,
      1,
      "occupied",
      "HG E 1.1",
      2,
    ],
    ["alex", "Alex Weber", "D-MAVT", 1580, 13, 1, 1, "occupied", "HCI G 3", 1],
  ];
  function seed() {
    return {
      version: 1,
      users: people.map((p, index) => {
        const [
          id,
          name,
          department,
          minutes,
          completed,
          missed,
          cancelled,
          state,
          room,
          seat,
        ] = p;
        const studiedNow = state === "break" ? 79 : state === "occupied" ? 84 : 0;
        const available = minutes - studiedNow;
        const records = [];
        const clock = (mins) =>
          String(Math.floor(mins / 60)).padStart(2, "0") +
          ":" +
          String(mins % 60).padStart(2, "0");
        for (let i = 0; i < completed + missed + cancelled; i++) {
          const day =
            9 - Math.floor((i * 28) / (completed + missed + cancelled));
          const date = new Date(Date.UTC(2026, 9, day))
            .toISOString()
            .slice(0, 10);
          const status =
            i < completed
              ? "completed"
              : i < completed + missed
                ? "missed"
                : "cancelled";
          const studyMinutes =
            status === "completed"
              ? Math.floor(available / completed) +
                (i < available % completed ? 1 : 0)
              : 0;
          records.push({
            id: id + "-history-" + i,
            date,
            start: "14:00",
            end: "16:00",
            room: "HCI G 3",
            seat: (i % 4) + 1,
            status,
            studyMinutes,
            breakMinutes: 0,
            checkedIn: status === "completed" ? "14:03" : null,
            endedAt:
              status === "completed" ? clock(14 * 60 + 3 + studyMinutes) : null,
          });
        }
        if (state)
          records.unshift({
            id: id + "-current",
            date: "2026-10-10",
            start: state === "reserved" ? "10:40" : "09:15",
            end: state === "reserved" ? "12:40" : "11:15",
            room,
            seat,
            status: state,
            studyMinutes: studiedNow,
            breakMinutes: state === "break" ? 5 : 0,
            checkedIn: state === "reserved" ? null : "09:18",
            deadline: state === "reserved" ? "10:50" : null,
            endedAt: null,
          });
        return {
          id,
          studentId: "ST-" + String(index + 1).padStart(4, "0"),
          name,
          email: id + ".student@example.com",
          department,
          records,
        };
      }),
    };
  }
  const live = (record) =>
    ["occupied", "reserved", "break"].includes(record.status);
  function load(storage) {
    try {
      const value = JSON.parse(storage.getItem(KEY));
      if (
        value?.version === 1 &&
        Array.isArray(value.users) &&
        value.users.length &&
        value.users.every(
          (u) =>
            typeof u.id === "string" &&
            typeof u.name === "string" &&
            typeof u.email === "string" &&
            typeof u.department === "string" &&
            Array.isArray(u.records) &&
            u.records.every(
              (r) =>
                typeof r.id === "string" &&
                typeof r.date === "string" &&
                [
                  "occupied",
                  "reserved",
                  "break",
                  "completed",
                  "missed",
                  "cancelled",
                  "ended",
                ].includes(r.status) &&
                Number.isInteger(r.studyMinutes) &&
                r.studyMinutes >= 0 &&
                Number.isInteger(r.breakMinutes) &&
                r.breakMinutes >= 0 &&
                typeof r.room === "string" &&
                Number.isInteger(r.seat) &&
                typeof r.start === "string" &&
                typeof r.end === "string",
            ),
        )
      )
        return value;
    } catch {
      /* Empty or unavailable storage: start with sample records. */
    }
    return seed();
  }
  function save(storage, state) {
    try {
      storage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }
  function updateProfile(state, id, patch) {
    const name = patch.name.trim(),
      email = patch.email.trim(),
      department = patch.department.trim();
    if (
      !name ||
      name.length > 80 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !department ||
      department.length > 64
    )
      throw new Error("Enter a name, valid email and department.");
    if (!state.users.some((u) => u.id === id))
      throw new Error("User not found.");
    return {
      ...state,
      users: state.users.map((u) =>
        u.id === id ? { ...u, name, email, department } : u,
      ),
    };
  }
  function endReservation(state, userId, reservationId) {
    const user = state.users.find((u) => u.id === userId);
    if (!user?.records.some((r) => r.id === reservationId))
      throw new Error("Reservation not found.");
    return {
      ...state,
      users: state.users.map((u) =>
        u.id === userId
          ? {
              ...u,
              records: u.records.map((r) =>
                r.id === reservationId && live(r)
                  ? {
                      ...r,
                      status: "ended",
                      endedAt: "10:42",
                      endedBy: "admin",
                    }
                  : r,
              ),
            }
          : u,
      ),
    };
  }
  const api = {
    KEY,
    NOW,
    seed,
    load,
    save,
    live,
    updateProfile,
    endReservation,
  };
  root.AdminUsersData = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
