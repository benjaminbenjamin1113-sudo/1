// Friend/notification helpers shared across the app, centered on one
// component: a dropdown anchored to a small "Friends" trigger button that
// every page mounts into its own #friendsDropdownRoot slot (part of the
// page's normal header layout, not a viewport-fixed overlay). The panel
// has three tabbed panes — Friends, Requests, Notifications — so most
// friend activity can happen without ever leaving the page you're on.
// "Manage friends →" in the footer still goes to the full friends.html
// for adding people, searching, and removing friends.

import { db, escapeHtml } from "./firebase.js";
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  arrayUnion,
  collection,
  query,
  where,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Deterministic id for the one friendRequests doc between two users,
// regardless of who sent the request — so "are we already friends or
// pending?" is a single getDoc instead of a query.
export function friendDocId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

// Appends one notification to the recipient's notifications/{uid} doc.
// Never throws — a failed notification shouldn't block the action that
// triggered it (e.g. a friend request should still go through even if the
// notification write fails for some reason).
export async function sendNotification(toUid, notification) {
  try {
    await setDoc(doc(db, "notifications", toUid), {
      items: arrayUnion({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        read: false,
        createdAt: Date.now(),
        ...notification
      })
    }, { merge: true });
  } catch (e) {
    console.error("Could not send notification:", e);
  }
}

const AVATAR_COLORS = ["#ff8a3d", "#4ade80", "#60a5fa", "#f472b6", "#a78bfa", "#fbbf24", "#34d399", "#f87171"];

function fdColorFor(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function fdInitials(name) {
  return String(name || "?").slice(0, 2).toUpperCase();
}

function fdTimeAgo(ts) {
  const diffMs = Date.now() - (ts || Date.now());
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fdOtherParty(req, uid) {
  const isFromMe = req.from === uid;
  return {
    uid: isFromMe ? req.to : req.from,
    username: isFromMe ? (req.toUsername || "User") : (req.fromUsername || "User")
  };
}

let fdUid = null;
let fdMyUsername = "";
let fdActiveTab = "friends";
let fdStyleInjected = false;
let fdRootEl = null;

// Registered once at module load rather than once per initFriendsDropdown
// call — a page can sign out and back in without stacking a fresh
// document-level click listener each time.
document.addEventListener("click", event => {
  if (fdRootEl && !fdRootEl.contains(event.target)) fdClosePanel();
});

let fdUnsubFrom = null;
let fdUnsubTo = null;
let fdUnsubNotif = null;

let fdFriends = [];
let fdIncoming = [];
let fdOutgoing = [];
let fdNotifications = [];
let fdPublished = new Map();

function fdInjectStyle() {
  if (fdStyleInjected) return;
  fdStyleInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    /* Matches this app's existing "secondary" button exactly (see
       button.secondary in shared/base.css and the inline-styled
       Profile/Logout buttons on the dashboard) — same border, same
       transparent fill, same dim text, same radius — so it reads as one
       of the page's own buttons instead of an imported widget. */
    .fd-trigger {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border, #2a2e38);
      background: transparent; color: var(--text-dim, #9aa0ab);
      font-size: 12px; font-weight: 600; line-height: 1.4;
      cursor: pointer; font-family: inherit; flex-shrink: 0;
    }
    .fd-trigger:hover { border-color: var(--accent, #ff8a3d); color: var(--text, #eceef2); }
    .fd-trigger.open { border-color: var(--accent, #ff8a3d); color: var(--text, #eceef2); }
    .fd-trigger-badge {
      display: none; align-items: center; justify-content: center;
      min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px;
      background: var(--danger, #e5484d); color: #fff; font-size: 10px; font-weight: 700;
    }
    .fd-trigger-badge.show { display: inline-flex; }

    .fd-panel {
      display: none; position: absolute; top: calc(100% + 8px); right: 0; z-index: 500;
      width: 320px; max-width: calc(100vw - 40px);
      border: 1px solid var(--border, #2a2e38); border-radius: 14px;
      background: var(--card, #1a1d24); box-shadow: 0 16px 44px rgba(0,0,0,0.5);
      overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .fd-panel.open { display: block; }

    .fd-tabs { display: flex; border-bottom: 1px solid var(--border, #2a2e38); }
    .fd-tab {
      flex: 1; padding: 10px 6px; border: none; background: transparent;
      color: var(--text-dim, #9aa0ab); font-size: 12px; font-weight: 600; cursor: pointer;
      font-family: inherit; border-bottom: 2px solid transparent;
    }
    .fd-tab.active { color: var(--accent, #ff8a3d); border-bottom-color: var(--accent, #ff8a3d); }
    .fd-tab-badge {
      display: none; align-items: center; justify-content: center;
      min-width: 15px; height: 15px; margin-left: 4px; padding: 0 3px; border-radius: 8px;
      background: var(--danger, #e5484d); color: #fff; font-size: 9px; font-weight: 700; vertical-align: middle;
    }

    .fd-body { max-height: 320px; overflow-y: auto; padding: 10px; }
    .fd-pane { display: none; }
    .fd-pane.active { display: block; }

    .fd-section-label {
      margin: 10px 0 6px; font-size: 10px; font-weight: 700; letter-spacing: .5px;
      text-transform: uppercase; color: var(--text-dim, #9aa0ab);
    }
    .fd-section-label:first-child { margin-top: 0; }
    .fd-empty { padding: 20px 10px; text-align: center; color: var(--text-dim, #9aa0ab); font-size: 12px; }

    .fd-row {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 6px; margin-bottom: 2px; border-radius: 8px;
    }
    .fd-row-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .fd-row-actions { display: flex; gap: 4px; flex-shrink: 0; }

    .fd-avatar {
      position: relative; display: flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border-radius: 50%; font-size: 11px; font-weight: 700; flex: none;
    }
    .fd-dot {
      position: absolute; bottom: -1px; right: -1px; width: 9px; height: 9px; border-radius: 50%;
      border: 2px solid var(--card, #1a1d24); background: var(--text-dim, #9aa0ab);
    }
    .fd-dot.online { background: var(--success, #4ade80); }

    .fd-name {
      font-size: 12.5px; font-weight: 600; color: var(--text, #eceef2);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .fd-icon-btn {
      display: flex; align-items: center; justify-content: center; flex: none;
      width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--border, #2a2e38);
      background: transparent; color: var(--text, #eceef2); font-size: 12px;
      text-decoration: none; cursor: pointer; font-family: inherit;
    }
    .fd-icon-btn:hover { border-color: var(--accent, #ff8a3d); }
    .fd-icon-btn.accept { color: var(--success, #4ade80); }
    .fd-icon-btn.accept:hover { border-color: var(--success, #4ade80); }
    .fd-icon-btn.danger { color: var(--danger, #e5484d); }
    .fd-icon-btn.danger:hover { border-color: var(--danger, #e5484d); }

    .fd-notif-row {
      display: flex; gap: 8px; padding: 8px; margin-bottom: 4px; border-radius: 8px;
      border-left: 2px solid var(--border, #2a2e38); font-size: 12px;
    }
    .fd-notif-row.unread { border-left-color: var(--accent, #ff8a3d); background: var(--accent-soft, #3a2a1e); }
    .fd-notif-icon { font-size: 14px; flex: none; line-height: 1.3; }
    .fd-notif-msg { color: var(--text, #eceef2); margin-bottom: 2px; }
    .fd-notif-time { color: var(--text-dim, #9aa0ab); font-size: 10px; }

    .fd-footer {
      display: block; padding: 10px 14px; text-align: center; border-top: 1px solid var(--border, #2a2e38);
      color: var(--accent, #ff8a3d); font-size: 12px; text-decoration: none; font-weight: 600;
    }
    .fd-footer:hover { text-decoration: underline; }
  `;
  document.head.appendChild(style);
}

function fdBuildDom(root) {
  fdRootEl = root;
  root.style.position = "relative";
  root.style.display = "inline-block";
  root.innerHTML = `
    <button id="fd-trigger" class="fd-trigger" type="button">
      👥 Friends<span id="fd-trigger-badge" class="fd-trigger-badge"></span>
    </button>
    <div id="fd-panel" class="fd-panel">
      <div class="fd-tabs">
        <button class="fd-tab active" id="fd-tab-friends" type="button">Friends</button>
        <button class="fd-tab" id="fd-tab-requests" type="button">Requests<span class="fd-tab-badge" id="fd-badge-requests"></span></button>
        <button class="fd-tab" id="fd-tab-notifications" type="button">Notifications<span class="fd-tab-badge" id="fd-badge-notifs"></span></button>
      </div>
      <div class="fd-body">
        <div class="fd-pane active" id="fd-pane-friends"></div>
        <div class="fd-pane" id="fd-pane-requests"></div>
        <div class="fd-pane" id="fd-pane-notifications"></div>
      </div>
      <a href="/friends.html" class="fd-footer">Manage friends →</a>
    </div>
  `;

  root.querySelector("#fd-trigger").addEventListener("click", event => {
    event.stopPropagation();
    fdTogglePanel();
  });
  root.querySelector("#fd-tab-friends").addEventListener("click", () => fdSetTab("friends"));
  root.querySelector("#fd-tab-requests").addEventListener("click", () => fdSetTab("requests"));
  root.querySelector("#fd-tab-notifications").addEventListener("click", () => fdSetTab("notifications"));
}

function fdTogglePanel() {
  const panel = document.getElementById("fd-panel");
  const trigger = document.getElementById("fd-trigger");
  if (!panel) return;
  const opening = !panel.classList.contains("open");
  panel.classList.toggle("open", opening);
  if (trigger) trigger.classList.toggle("open", opening);
  if (opening && fdActiveTab === "notifications") fdMarkNotificationsRead();
}

function fdClosePanel() {
  const panel = document.getElementById("fd-panel");
  const trigger = document.getElementById("fd-trigger");
  if (panel) panel.classList.remove("open");
  if (trigger) trigger.classList.remove("open");
}

function fdSetTab(tab) {
  fdActiveTab = tab;
  ["friends", "requests", "notifications"].forEach(t => {
    const pane = document.getElementById(`fd-pane-${t}`);
    const tabBtn = document.getElementById(`fd-tab-${t}`);
    if (pane) pane.classList.toggle("active", t === tab);
    if (tabBtn) tabBtn.classList.toggle("active", t === tab);
  });
  if (tab === "notifications") fdMarkNotificationsRead();
}

function fdRenderFriends() {
  const el = document.getElementById("fd-pane-friends");
  if (!el) return;

  if (!fdFriends.length) {
    el.innerHTML = `<div class="fd-empty">No friends yet.</div>`;
    return;
  }

  const rows = fdFriends
    .map(req => ({ req, other: fdOtherParty(req, fdUid) }))
    .sort((a, b) => {
      const aPub = fdPublished.get(a.other.uid) ? 1 : 0;
      const bPub = fdPublished.get(b.other.uid) ? 1 : 0;
      if (aPub !== bPub) return bPub - aPub;
      return a.other.username.localeCompare(b.other.username);
    });

  el.innerHTML = rows.map(({ other }) => {
    const color = fdColorFor(other.username);
    const isPublished = fdPublished.get(other.uid) === true;
    return `
      <div class="fd-row">
        <div class="fd-row-left">
          <div class="fd-avatar" style="background:${color}26; color:${color};">
            ${fdInitials(other.username)}<span class="fd-dot ${isPublished ? "online" : ""}"></span>
          </div>
          <div class="fd-name">${escapeHtml(other.username)}</div>
        </div>
        ${isPublished ? `<a class="fd-icon-btn" href="/schedule.html?friend=${encodeURIComponent(other.uid)}" title="View Schedule">📅</a>` : ""}
      </div>
    `;
  }).join("");
}

function fdRequestRow(req, opts) {
  const other = fdOtherParty(req, fdUid);
  const color = fdColorFor(other.username);
  return `
    <div class="fd-row">
      <div class="fd-row-left">
        <div class="fd-avatar" style="background:${color}26; color:${color};">${fdInitials(other.username)}</div>
        <div class="fd-name">${escapeHtml(other.username)}</div>
      </div>
      <div class="fd-row-actions">${opts}</div>
    </div>
  `;
}

function fdRenderRequests() {
  const el = document.getElementById("fd-pane-requests");
  if (!el) return;

  const incomingHtml = fdIncoming.length
    ? fdIncoming.map(req => fdRequestRow(req, `
        <button class="fd-icon-btn accept" onclick="window.__fdAccept('${req.id}','${req.from}')" title="Accept">✓</button>
        <button class="fd-icon-btn danger" onclick="window.__fdDecline('${req.id}')" title="Decline">✕</button>
      `)).join("")
    : `<div class="fd-empty">No incoming requests.</div>`;

  const outgoingHtml = fdOutgoing.length
    ? fdOutgoing.map(req => fdRequestRow(req, `
        <button class="fd-icon-btn danger" onclick="window.__fdCancel('${req.id}')" title="Cancel">✕</button>
      `)).join("")
    : `<div class="fd-empty">No outgoing requests.</div>`;

  el.innerHTML = `
    <div class="fd-section-label">Incoming</div>
    ${incomingHtml}
    <div class="fd-section-label">Outgoing</div>
    ${outgoingHtml}
  `;
}

function fdRenderNotifications() {
  const el = document.getElementById("fd-pane-notifications");
  if (!el) return;

  if (!fdNotifications.length) {
    el.innerHTML = `<div class="fd-empty">No notifications.</div>`;
    return;
  }

  const sorted = fdNotifications.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  el.innerHTML = sorted.slice(0, 15).map(n => `
    <div class="fd-notif-row ${n.read ? "" : "unread"}">
      <div class="fd-notif-icon">${n.type === "friend_accepted" ? "🎉" : n.type === "friend_request" ? "👋" : "🔔"}</div>
      <div>
        <div class="fd-notif-msg">${escapeHtml(n.message || "")}</div>
        <div class="fd-notif-time">${fdTimeAgo(n.createdAt)}</div>
      </div>
    </div>
  `).join("");
}

function fdUpdateBadges() {
  const unread = fdNotifications.filter(n => !n.read).length;
  const totalAlerts = fdIncoming.length + unread;

  const triggerBadge = document.getElementById("fd-trigger-badge");
  if (triggerBadge) {
    if (totalAlerts > 0) {
      triggerBadge.textContent = totalAlerts > 9 ? "9+" : String(totalAlerts);
      triggerBadge.classList.add("show");
    } else {
      triggerBadge.classList.remove("show");
    }
  }

  const reqBadge = document.getElementById("fd-badge-requests");
  if (reqBadge) {
    if (fdIncoming.length > 0) {
      reqBadge.textContent = fdIncoming.length > 9 ? "9+" : String(fdIncoming.length);
      reqBadge.style.display = "inline-flex";
    } else {
      reqBadge.style.display = "none";
    }
  }

  const notifBadge = document.getElementById("fd-badge-notifs");
  if (notifBadge) {
    if (unread > 0) {
      notifBadge.textContent = unread > 9 ? "9+" : String(unread);
      notifBadge.style.display = "inline-flex";
    } else {
      notifBadge.style.display = "none";
    }
  }
}

// Each friend's users/{uid} doc is blanket-readable to any signed-in user
// (same rule the leaderboard already relies on), so a plain getDoc per
// friend is enough to know whether their schedule is publicly viewable
// right now — the "online" signal behind the dropdown's status dots.
async function fdRefreshPublished() {
  const results = await Promise.all(fdFriends.map(async req => {
    const other = fdOtherParty(req, fdUid);
    try {
      const snap = await getDoc(doc(db, "users", other.uid));
      return [other.uid, snap.exists() && snap.data().published === true];
    } catch (e) {
      console.error("Could not check published status:", e);
      return [other.uid, false];
    }
  }));
  fdPublished = new Map(results);
  fdRenderFriends();
}

async function fdMarkNotificationsRead() {
  if (!fdUid || !fdNotifications.some(n => !n.read)) return;
  try {
    const updated = fdNotifications.map(n => ({ ...n, read: true }));
    await setDoc(doc(db, "notifications", fdUid), { items: updated }, { merge: true });
  } catch (e) {
    console.error("Could not mark notifications read:", e);
  }
}

async function fdAcceptRequest(requestId, fromUid) {
  try {
    await updateDoc(doc(db, "friendRequests", requestId), { status: "accepted", respondedAt: Date.now() });
    await sendNotification(fromUid, {
      type: "friend_accepted",
      message: `${fdMyUsername} accepted your friend request`,
      relatedId: requestId
    });
  } catch (e) {
    console.error("Could not accept friend request:", e);
  }
}

async function fdDeclineRequest(requestId) {
  try {
    await deleteDoc(doc(db, "friendRequests", requestId));
  } catch (e) {
    console.error("Could not decline friend request:", e);
  }
}

async function fdCancelRequest(requestId) {
  try {
    await deleteDoc(doc(db, "friendRequests", requestId));
  } catch (e) {
    console.error("Could not cancel friend request:", e);
  }
}

window.__fdAccept = fdAcceptRequest;
window.__fdDecline = fdDeclineRequest;
window.__fdCancel = fdCancelRequest;

function fdStartFriendListeners(uid) {
  if (fdUnsubFrom) fdUnsubFrom();
  if (fdUnsubTo) fdUnsubTo();

  let fromDocs = [];
  let toDocs = [];

  function recompute() {
    const byId = new Map();
    [...fromDocs, ...toDocs].forEach(d => byId.set(d.id, d));
    const merged = [...byId.values()];

    fdOutgoing = merged.filter(r => r.status === "pending" && r.from === uid);
    fdIncoming = merged.filter(r => r.status === "pending" && r.to === uid);
    fdFriends = merged.filter(r => r.status === "accepted");

    renderFdFriendsAndRequests();
  }

  function renderFdFriendsAndRequests() {
    fdRenderFriends();
    fdRenderRequests();
    fdUpdateBadges();
    fdRefreshPublished();
  }

  fdUnsubFrom = onSnapshot(
    query(collection(db, "friendRequests"), where("from", "==", uid)),
    snapshot => {
      fromDocs = [];
      snapshot.forEach(d => fromDocs.push({ id: d.id, ...d.data() }));
      recompute();
    },
    error => console.error("Friends dropdown (from) listener failed:", error)
  );

  fdUnsubTo = onSnapshot(
    query(collection(db, "friendRequests"), where("to", "==", uid)),
    snapshot => {
      toDocs = [];
      snapshot.forEach(d => toDocs.push({ id: d.id, ...d.data() }));
      recompute();
    },
    error => console.error("Friends dropdown (to) listener failed:", error)
  );
}

function fdStartNotifListener(uid) {
  if (fdUnsubNotif) fdUnsubNotif();
  fdUnsubNotif = onSnapshot(doc(db, "notifications", uid), snapshot => {
    fdNotifications = snapshot.exists() && Array.isArray(snapshot.data().items) ? snapshot.data().items : [];
    fdRenderNotifications();
    fdUpdateBadges();
  }, error => console.error("Friends dropdown notifications listener failed:", error));
}

// Call from a page's onAuthStateChanged signed-in branch, passing the
// user's uid and username. Mounts the trigger + panel into the page's
// own #friendsDropdownRoot element — a normal part of the header layout,
// not a fixed overlay — so it looks and behaves the same everywhere.
export function initFriendsDropdown(uid, username) {
  const root = document.getElementById("friendsDropdownRoot");
  if (!root) return;

  fdInjectStyle();
  fdUid = uid;
  fdMyUsername = username || "";
  fdActiveTab = "friends";
  fdBuildDom(root);
  fdStartFriendListeners(uid);
  fdStartNotifListener(uid);
}

export function teardownFriendsDropdown() {
  if (fdUnsubFrom) { fdUnsubFrom(); fdUnsubFrom = null; }
  if (fdUnsubTo) { fdUnsubTo(); fdUnsubTo = null; }
  if (fdUnsubNotif) { fdUnsubNotif(); fdUnsubNotif = null; }
  fdFriends = [];
  fdIncoming = [];
  fdOutgoing = [];
  fdNotifications = [];
  fdPublished = new Map();
  fdUid = null;
  fdRootEl = null;

  const root = document.getElementById("friendsDropdownRoot");
  if (root) root.innerHTML = "";
}
