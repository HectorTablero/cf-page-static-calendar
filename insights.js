// Insights Lab
// =============
// A small programmable console layered on top of the calendar data. It exposes
// three interfaces to user-written snippets:
//
//   data   – CalendarDataset, a queryable wrapper around the logged events.
//   out    – Report, a view that renders results as page elements (never raw dumps).
//   stats  – a library of statistics/formatting helpers (median, quantile, pearson…).
//
// A snippet is just a function body with those three names in scope. The recipe
// library below are ready-made snippets the user can run, read, and edit.

(function () {
    "use strict";

    // ---------------------------------------------------------------------
    // Small utilities
    // ---------------------------------------------------------------------

    const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const HOUR_MS = 1000 * 60 * 60;
    const DAY_MS = HOUR_MS * 24;
    const FALLBACK_COLOR = "#94a3b8";

    function dayKeyOf(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function splitActivities(summary) {
        const parts = String(summary || "")
            .split("+")
            .map((part) => part.trim())
            .filter(Boolean);
        return parts.length ? parts : [String(summary || "").trim() || "?"];
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    // ---------------------------------------------------------------------
    // Activity notes
    // ---------------------------------------------------------------------
    // Context about how certain labels are logged. Only notes whose activity
    // actually appears in a result are attached when exporting to Markdown, so
    // the reader gets the caveats that are relevant to what they're looking at.
    const ACTIVITY_NOTES = {
        Friend: '"Friend" (singular) does not always refer to the same person — it is distinguished from "Friends" mainly by the number of people involved. Social labels like this can completely swallow whatever else was happening (Exercise, Walk, meals...); they only show up in a combination such as "Work + Friend" when that other activity was the main focus.',
        Friends: '"Friends" (plural) covers time spent with a group rather than one person. Social labels like this can completely swallow whatever else was happening (Exercise, Walk, meals...); they only show up in a combination such as "Work + Friends" when that other activity was the main focus.',
        Family: '"Family" is a social label that can completely swallow whatever else was happening (Exercise, Walk, meals...). It only shows up in a combination such as "Work + Family" when that other activity was the main focus.',
        Exercise: '"Exercise" is a broad label for any kind of physical activity (snowboarding, diving...). This label only appears when exercising alone for a period well over 15 minutes, so it is mainly reserved for sports trips. I tend to do shorter daily calisthenics workouts daily.',
        Work: '"Work" is not limited to employment. It can also represent volunteering or other tasks that are not Project. Admittedly, sometimes I log "Work" when I meant "Project", though the dataset is generally precise enough and the difference between the two labels isn\'t that significant.',
        Rest: '"Rest" represents completely idle time when awake.',
        "?": '"?" represents time I forgot to log in the moment and couldn\'t reconstruct afterwards through browser history, photo timestamps, etc. This is mainly concentrated during trips or situations where I am too immersed to log.',
        Class: '"Class" represents only time spent in a lecture or class practice in person. It does not include Homework.',
        Languages: '"Languages" represents time spent learning a language, usually through Duolingo (Italian), WaniKani (Japanese) or books. My sessions tend to last less than 15 minutes (not logged), hence why the hour totals are low, but I practice daily without exception.',
        Cooking: 'I tend to multitask heavily when "Cooking", so this label only appears when I am fully focused on Cooking, and usually for long sessions (elaborate dishes).',
        Series: '"Series" only represents Western media, and is separate from the activity Anime.',
        Event: '"Event" mainly represents in-person workshops or expert discussions, and is logged both when I am an attendee and when I am the one presenting the Event.',
        Writing: '"Writing" is limited to creative writing, and does not include Work, Project or Research related writing.'
    };

    // ---------------------------------------------------------------------
    // stats – statistics & formatting helpers
    // ---------------------------------------------------------------------

    const stats = {
        WEEKDAYS,
        WEEKDAYS_SHORT,
        MONTHS,
        MONTHS_SHORT,

        sum(values) {
            return values.reduce((total, value) => total + (Number(value) || 0), 0);
        },
        mean(values) {
            return values.length ? stats.sum(values) / values.length : 0;
        },
        min(values) {
            return values.length ? Math.min(...values) : 0;
        },
        max(values) {
            return values.length ? Math.max(...values) : 0;
        },
        quantile(values, q) {
            if (!values.length) return 0;
            const sorted = [...values].sort((a, b) => a - b);
            const pos = (sorted.length - 1) * q;
            const base = Math.floor(pos);
            const rest = pos - base;
            if (sorted[base + 1] !== undefined) {
                return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
            }
            return sorted[base];
        },
        median(values) {
            return stats.quantile(values, 0.5);
        },
        std(values) {
            if (values.length < 2) return 0;
            const avg = stats.mean(values);
            const variance = stats.sum(values.map((value) => (value - avg) ** 2)) / (values.length - 1);
            return Math.sqrt(variance);
        },
        round(value, decimals = 1) {
            const factor = 10 ** decimals;
            return Math.round(Number(value) * factor) / factor;
        },
        // Pearson correlation coefficient between two equal-length series.
        pearson(xs, ys) {
            const n = Math.min(xs.length, ys.length);
            if (n < 2) return 0;
            const mx = stats.mean(xs.slice(0, n));
            const my = stats.mean(ys.slice(0, n));
            let num = 0;
            let dx = 0;
            let dy = 0;
            for (let i = 0; i < n; i++) {
                const a = xs[i] - mx;
                const b = ys[i] - my;
                num += a * b;
                dx += a * a;
                dy += b * b;
            }
            const denom = Math.sqrt(dx * dy);
            return denom === 0 ? 0 : num / denom;
        },
        // Group an array into a Map keyed by keyFn(item). keyFn defaults to
        // identity, so groupBy(names) buckets equal values together.
        groupBy(items, keyFn = (item) => item) {
            const map = new Map();
            items.forEach((item, index) => {
                const key = keyFn(item, index);
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(item);
            });
            return map;
        },
        // Count occurrences by key, returned as a sorted [key, count][] array.
        // keyFn defaults to identity, so countBy(["a", "a", "b"]) → [["a", 2], ["b", 1]].
        countBy(items, keyFn = (item) => item) {
            const map = new Map();
            items.forEach((item, index) => {
                const key = keyFn(item, index);
                map.set(key, (map.get(key) || 0) + 1);
            });
            return [...map.entries()].sort((a, b) => b[1] - a[1]);
        },

        formatHours(hours) {
            const value = Number(hours) || 0;
            if (value < 1) return `${Math.round(value * 60)}m`;
            const whole = Math.floor(value);
            const minutes = Math.round((value - whole) * 60);
            if (minutes === 0) return `${whole}h`;
            if (minutes === 60) return `${whole + 1}h`;
            return `${whole}h ${minutes}m`;
        },
        formatDate(date) {
            const d = date instanceof Date ? date : new Date(date);
            return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        },
        formatDateTime(date) {
            const d = date instanceof Date ? date : new Date(date);
            return `${stats.formatDate(d)}, ${stats.formatClock(d.getHours() * 60 + d.getMinutes())}`;
        },
        // Minutes-from-UTC → "GMT+9" / "GMT+5:30" / "GMT−4".
        formatOffset(offsetMinutes) {
            if (!Number.isFinite(offsetMinutes)) return "GMT";
            const sign = offsetMinutes < 0 ? "−" : "+";
            const abs = Math.abs(offsetMinutes);
            const hours = Math.floor(abs / 60);
            const mins = abs % 60;
            return `GMT${sign}${hours}${mins ? ":" + String(mins).padStart(2, "0") : ""}`;
        },
        // Accepts either a Date or minutes-from-midnight and returns "HH:MM".
        formatClock(value) {
            let minutes = value;
            if (value instanceof Date) minutes = value.getHours() * 60 + value.getMinutes();
            minutes = Math.round(minutes);
            const hours = Math.floor((minutes % 1440) / 60);
            const mins = ((minutes % 60) + 60) % 60;
            return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
        }
    };

    // ---------------------------------------------------------------------
    // CalendarDataset – the queryable data interface (`data`)
    // ---------------------------------------------------------------------

    class CalendarDataset {
        constructor(rawEvents, meta) {
            this.meta = meta || {};
            this.categoryNames = this.meta.categoryNames || {};

            // Day-split segments, exactly as rendered on the calendar. Good for
            // per-day questions (fragmentation, time-of-day, weekday rhythm).
            this.blocks = rawEvents.map((raw) => this._toBlock(raw)).sort((a, b) => a.start - b.start);

            // Original events, re-merged across midnight boundaries. Good for
            // duration questions (longest sessions, awake stretches, sequences).
            this.events = this._mergeEvents(rawEvents).sort((a, b) => a.start - b.start);

            // Per-day index.
            this.dayMap = new Map();
            this.blocks.forEach((block) => {
                if (!this.dayMap.has(block.dayKey)) {
                    this.dayMap.set(block.dayKey, { dayKey: block.dayKey, date: new Date(block.start.getFullYear(), block.start.getMonth(), block.start.getDate()), blocks: [] });
                }
                this.dayMap.get(block.dayKey).blocks.push(block);
            });
            this.days = [...this.dayMap.values()].sort((a, b) => a.date - b.date);

            this.range = this.days.length ? { firstDay: this.days[0].date, lastDay: this.days[this.days.length - 1].date, totalDays: Math.round((this.days[this.days.length - 1].date - this.days[0].date) / DAY_MS) + 1 } : { firstDay: null, lastDay: null, totalDays: 0 };

            this._activityCache = null;
        }

        _toBlock(raw) {
            const start = new Date(raw.start.dateTime);
            const end = new Date(raw.end.dateTime);
            const color = raw.color || FALLBACK_COLOR;
            return {
                summary: raw.summary,
                activities: splitActivities(raw.summary),
                color,
                category: this.categoryNames[color] || "Unknown",
                start,
                end,
                hours: (end - start) / HOUR_MS,
                dayKey: dayKeyOf(start),
                weekday: start.getDay(),
                month: start.getMonth(),
                year: start.getFullYear(),
                startMinutes: start.getHours() * 60 + start.getMinutes(),
                // Only the (accurate) UTC offset is exposed — the underlying IANA
                // location is unreliable, so it is deliberately not surfaced here.
                offsetMinutes: raw.offsetMinutes,
                offsetFromHome: raw.offsetFromHome || 0,
                isContinuation: !!raw.continuation,
                raw
            };
        }

        _mergeEvents(rawEvents) {
            const byKey = new Map();
            rawEvents.forEach((raw) => {
                const realStart = new Date((raw.trueStart || raw.start).dateTime);
                const realEnd = new Date((raw.trueEnd || raw.end).dateTime);
                const key = `${raw.summary}|${realStart.getTime()}|${realEnd.getTime()}`;
                if (byKey.has(key)) return;
                const color = raw.color || FALLBACK_COLOR;
                byKey.set(key, {
                    summary: raw.summary,
                    activities: splitActivities(raw.summary),
                    color,
                    category: this.categoryNames[color] || "Unknown",
                    start: realStart,
                    end: realEnd,
                    hours: (realEnd - realStart) / HOUR_MS,
                    dayKey: dayKeyOf(realStart),
                    weekday: realStart.getDay(),
                    month: realStart.getMonth(),
                    year: realStart.getFullYear(),
                    startMinutes: realStart.getHours() * 60 + realStart.getMinutes(),
                    offsetMinutes: raw.offsetMinutes,
                    offsetFromHome: raw.offsetFromHome || 0,
                    spanDays: Math.max(1, Math.ceil((realEnd - realStart) / DAY_MS))
                });
            });
            return [...byKey.values()];
        }

        // True when `item` (block or event) is logged under `name` (case-insensitive).
        has(item, name) {
            const target = String(name).trim().toLowerCase();
            return item.activities.some((activity) => activity.toLowerCase() === target);
        }

        // True when the item matches ANY of the given names.
        hasAny(item, names) {
            return names.some((name) => this.has(item, name));
        }

        // Merged events logged under `name`.
        withActivity(name) {
            return this.events.filter((event) => this.has(event, name));
        }

        // Day-split blocks logged under `name`.
        blocksOf(name) {
            return this.blocks.filter((block) => this.has(block, name));
        }

        // Total logged hours for `name` (a composed block counts its full length).
        hoursOf(name) {
            return stats.sum(this.blocksOf(name).map((block) => block.hours));
        }

        // The most frequently used colour for an activity.
        colorOf(name) {
            const counts = stats.countBy(this.blocksOf(name), (block) => block.color);
            return counts.length ? counts[0][0] : FALLBACK_COLOR;
        }

        // Lazily-built lower-cased set of every known activity name.
        _nameSet() {
            if (!this._names) this._names = new Set(this.activities().map((a) => a.name.toLowerCase()));
            return this._names;
        }

        // True when `name` is a known activity label.
        hasName(name) {
            return this._nameSet().has(String(name).trim().toLowerCase());
        }

        // The display colour for a known activity, or null if unknown. Used to
        // put a coloured dot next to names in the console and its output.
        entryColor(name) {
            return this.hasName(name) ? this.colorOf(name) : null;
        }

        // Every colour-category with usage stats and a representative colour.
        categories() {
            if (this._categoryCache) return this._categoryCache;
            const map = new Map();
            this.blocks.forEach((block) => {
                if (!map.has(block.category)) map.set(block.category, { name: block.category, hours: 0, days: new Set(), colors: new Map() });
                const entry = map.get(block.category);
                entry.hours += block.hours;
                entry.days.add(block.dayKey);
                entry.colors.set(block.color, (entry.colors.get(block.color) || 0) + 1);
            });
            this._categoryCache = [...map.values()].map((entry) => ({ name: entry.name, color: [...entry.colors.entries()].sort((a, b) => b[1] - a[1])[0][0], hours: entry.hours, days: entry.days.size })).sort((a, b) => b.hours - a.hours);
            return this._categoryCache;
        }

        _categorySet() {
            if (!this._categoryNamesLower) this._categoryNamesLower = new Set(this.categories().map((category) => category.name.toLowerCase()));
            return this._categoryNamesLower;
        }

        // True when `name` is a known colour-category label.
        hasCategory(name) {
            return this._categorySet().has(String(name).trim().toLowerCase());
        }

        // The representative colour for a known category, or null if unknown.
        categoryColor(name) {
            if (!this.hasCategory(name)) return null;
            const key = String(name).trim().toLowerCase();
            return this.categories().find((category) => category.name.toLowerCase() === key).color;
        }

        // Vocabulary: every activity name with usage stats, most-used first.
        activities() {
            if (this._activityCache) return this._activityCache;
            const map = new Map();
            this.blocks.forEach((block) => {
                block.activities.forEach((name) => {
                    if (!map.has(name)) map.set(name, { name, color: block.color, hours: 0, blocks: 0, events: new Set(), days: new Set(), first: block.start, last: block.start });
                    const entry = map.get(name);
                    entry.hours += block.hours;
                    entry.blocks += 1;
                    entry.days.add(block.dayKey);
                    if (block.start < entry.first) entry.first = block.start;
                    if (block.start > entry.last) entry.last = block.start;
                });
            });
            this.events.forEach((event) => {
                event.activities.forEach((name) => {
                    if (map.has(name)) map.get(name).events.add(event);
                });
            });
            this._activityCache = [...map.values()].map((entry) => ({ name: entry.name, color: entry.color, hours: entry.hours, blocks: entry.blocks, count: entry.events.size, days: entry.days.size, first: entry.first, last: entry.last })).sort((a, b) => b.hours - a.hours);
            return this._activityCache;
        }

        // Every calendar day between the first and last log, including gaps.
        calendarDays() {
            const out = [];
            if (!this.range.firstDay) return out;
            const cursor = new Date(this.range.firstDay);
            while (cursor <= this.range.lastDay) {
                const key = dayKeyOf(cursor);
                out.push(this.dayMap.get(key) || { dayKey: key, date: new Date(cursor), blocks: [] });
                cursor.setDate(cursor.getDate() + 1);
            }
            return out;
        }

        // For each merged event logged under `name`, the activities of the event
        // immediately preceding it on the timeline. Returns [name, count][] sorted.
        // Because every quarter-hour is logged, "preceding" means contiguous.
        precededBy(name, { offset = -1 } = {}) {
            return this._neighbourCounts(name, offset);
        }
        followedBy(name, { offset = 1 } = {}) {
            return this._neighbourCounts(name, offset);
        }
        _neighbourCounts(name, offset) {
            const target = String(name).trim().toLowerCase();
            const counts = new Map();
            for (let i = 0; i < this.events.length; i++) {
                if (!this.has(this.events[i], name)) continue;
                const neighbour = this.events[i + offset];
                if (!neighbour) continue;
                neighbour.activities.forEach((activity) => {
                    if (activity.toLowerCase() === target) return;
                    counts.set(activity, (counts.get(activity) || 0) + 1);
                });
            }
            return [...counts.entries()].sort((a, b) => b[1] - a[1]);
        }
    }

    // ---------------------------------------------------------------------
    // Report – the results view interface (`out`)
    // ---------------------------------------------------------------------

    class Report {
        constructor(container, options = {}) {
            this.container = container;
            this._count = 0;
            // A parallel, structured record of everything rendered, used to
            // serialise the results to Markdown (see toMarkdown).
            this.log = [];
            // Optional (name) => colour|null lookup. When a rendered cell/list text
            // is a known activity name, it gets a leading dot in that colour.
            this.entryColor = options.entryColor || (() => null);
        }

        _record(entry) {
            this.log.push(entry);
        }

        // Build a text node or, for a recognised activity name, a dot + name span.
        _nameContent(value) {
            const color = typeof value === "string" ? this.entryColor(value) : null;
            if (!color) return document.createTextNode(value === undefined || value === null ? "" : String(value));
            const wrap = el("span", "insights-named");
            const dot = el("span", "insights-dot");
            dot.style.backgroundColor = color;
            wrap.appendChild(dot);
            wrap.appendChild(el("span", "insights-named__text", value));
            return wrap;
        }

        clear() {
            this.container.replaceChildren();
            this._count = 0;
            this.log = [];
            return this;
        }
        hasContent() {
            return this._count > 0;
        }
        _add(node) {
            this.container.appendChild(node);
            this._count += 1;
            return this;
        }

        heading(text) {
            this._record({ t: "heading", text: String(text) });
            return this._add(el("h3", "insights-block__heading", text));
        }
        subheading(text) {
            this._record({ t: "subheading", text: String(text) });
            return this._add(el("h4", "insights-block__subheading", text));
        }
        p(text) {
            this._record({ t: "p", text: String(text) });
            return this._add(el("p", "insights-block__text", text));
        }
        note(text) {
            this._record({ t: "note", text: String(text) });
            return this._add(el("p", "insights-block__note", text));
        }
        callout(text, kind = "info") {
            this._record({ t: "callout", text: String(text), kind });
            const node = el("div", `insights-callout insights-callout--${kind}`, text);
            return this._add(node);
        }
        divider() {
            this._record({ t: "divider" });
            return this._add(el("hr", "insights-block__divider"));
        }

        // One prominent statistic.
        stat(value, label, sub) {
            return this.stats([{ value, label, sub }]);
        }
        // A responsive grid of statistics: [{ value, label, sub }].
        stats(items) {
            this._record({ t: "stats", items: items.map((item) => ({ value: item.value, label: item.label, sub: item.sub })) });
            const grid = el("div", "insights-stats");
            items.forEach((item) => {
                const card = el("div", "insights-stat");
                card.appendChild(el("strong", "insights-stat__value", item.value));
                if (item.label) card.appendChild(el("span", "insights-stat__label", item.label));
                if (item.sub) card.appendChild(el("span", "insights-stat__sub", item.sub));
                grid.appendChild(card);
            });
            return this._add(grid);
        }

        // A definition list from [[key, value], …] pairs.
        keyValues(pairs) {
            this._record({ t: "keyValues", pairs: pairs.map(([key, value]) => [key, value]) });
            const list = el("dl", "insights-kv");
            pairs.forEach(([key, value]) => {
                list.appendChild(el("dt", "insights-kv__key", key));
                list.appendChild(el("dd", "insights-kv__value", value));
            });
            return this._add(list);
        }

        // A bulleted list. Items are strings or { text, meta }.
        list(items) {
            this._record({
                t: "list",
                items: items.map((item) => (item && typeof item === "object" ? { text: item.text, meta: item.meta } : { text: item }))
            });
            const ul = el("ul", "insights-list");
            items.forEach((item) => {
                const li = el("li", "insights-list__item");
                if (item && typeof item === "object") {
                    const text = el("span", "insights-list__text");
                    text.appendChild(this._nameContent(item.text));
                    li.appendChild(text);
                    if (item.meta !== undefined) li.appendChild(el("span", "insights-list__meta", item.meta));
                } else {
                    li.appendChild(this._nameContent(item));
                }
                ul.appendChild(li);
            });
            return this._add(ul);
        }

        // A table. columns: string[]; rows: (string|number)[][].
        table({ columns = [], rows = [] }) {
            this._record({ t: "table", columns: columns.slice(), rows: rows.map((row) => row.slice()) });
            const wrap = el("div", "insights-table-wrap");
            const table = el("table", "insights-table");
            const thead = el("thead");
            const headRow = el("tr");
            columns.forEach((col) => headRow.appendChild(el("th", null, col)));
            thead.appendChild(headRow);
            table.appendChild(thead);
            const tbody = el("tbody");
            rows.forEach((row) => {
                const tr = el("tr");
                row.forEach((cell) => {
                    const td = el("td");
                    td.appendChild(this._nameContent(cell));
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            wrap.appendChild(table);
            return this._add(wrap);
        }

        // A horizontal bar chart. items: [{ label, value, sub?, color? }].
        bars({ items = [], max, format }) {
            const formatter = format || ((value) => stats.round(value, 1));
            const ceiling = max !== undefined ? max : stats.max(items.map((item) => item.value)) || 1;
            this._record({
                t: "bars",
                items: items.map((item) => ({ label: item.label, value: item.value, display: item.sub !== undefined ? item.sub : formatter(item.value) }))
            });
            const chart = el("div", "insights-bars");
            items.forEach((item) => {
                const row = el("div", "insights-bars__row");
                row.appendChild(el("span", "insights-bars__label", item.label));
                const track = el("div", "insights-bars__track");
                const fill = el("div", "insights-bars__fill");
                fill.style.width = `${Math.max(0, Math.min(100, (item.value / ceiling) * 100))}%`;
                fill.style.backgroundColor = item.color || "#2563eb";
                track.appendChild(fill);
                row.appendChild(track);
                row.appendChild(el("span", "insights-bars__value", item.sub !== undefined ? item.sub : formatter(item.value)));
                chart.appendChild(row);
            });
            return this._add(chart);
        }

        // Escape hatch: pretty-print any value as JSON.
        raw(value) {
            let json;
            try {
                json = JSON.stringify(value, (key, val) => (val instanceof Date ? val.toISOString() : val), 2);
            } catch (error) {
                json = String(value);
            }
            this._record({ t: "raw", text: json });
            const pre = el("pre", "insights-raw");
            try {
                pre.textContent = JSON.stringify(value, (key, val) => (val instanceof Date ? val.toISOString() : val), 2);
            } catch (error) {
                pre.textContent = String(value);
            }
            return this._add(pre);
        }

        // Best-effort rendering of a returned value when a snippet used no out.* calls.
        auto(value) {
            if (value === null || value === undefined) return this;
            if (Array.isArray(value) && value.length && typeof value[0] === "object" && !(value[0] instanceof Date)) {
                const columns = [...new Set(value.flatMap((row) => Object.keys(row)))];
                const rows = value.map((row) => columns.map((col) => formatCell(row[col])));
                return this.table({ columns, rows });
            }
            if (typeof value === "object" && !(value instanceof Date)) {
                return this.keyValues(Object.entries(value).map(([key, val]) => [key, formatCell(val)]));
            }
            return this.stat(formatCell(value), "Result");
        }

        error(err) {
            this._record({ t: "error", title: err.name === "SyntaxError" ? "Syntax error" : "Error", text: err.message });
            const box = el("div", "insights-callout insights-callout--error");
            box.appendChild(el("strong", null, err.name === "SyntaxError" ? "Syntax error" : "Error"));
            box.appendChild(el("span", "insights-error__message", err.message));
            return this._add(box);
        }

        // Serialise the recorded results to Markdown. Options:
        //   code  – the snippet source to embed in a fenced block (or null).
        //   notes – when true, append context for any noted activity that shows up.
        toMarkdown({ code = null, notes = true } = {}) {
            const lines = [];
            const cell = (value) => mdText(value);

            this.log.forEach((entry) => {
                switch (entry.t) {
                    case "heading":
                        lines.push(`## ${cell(entry.text)}`, "");
                        break;
                    case "subheading":
                        lines.push(`### ${cell(entry.text)}`, "");
                        break;
                    case "p":
                        lines.push(cell(entry.text), "");
                        break;
                    case "note":
                        lines.push(`_${cell(entry.text)}_`, "");
                        break;
                    case "callout":
                        lines.push(`> ${cell(entry.text)}`, "");
                        break;
                    case "error":
                        lines.push(`> **${cell(entry.title)}:** ${cell(entry.text)}`, "");
                        break;
                    case "divider":
                        lines.push("---", "");
                        break;
                    case "stats":
                        entry.items.forEach((item) => {
                            const bits = [`**${cell(item.value)}**`];
                            if (item.label) bits.push(`— ${cell(item.label)}`);
                            if (item.sub) bits.push(`(${cell(item.sub)})`);
                            lines.push(`- ${bits.join(" ")}`);
                        });
                        lines.push("");
                        break;
                    case "keyValues":
                        entry.pairs.forEach(([key, value]) => lines.push(`- **${cell(key)}:** ${cell(value)}`));
                        lines.push("");
                        break;
                    case "list":
                        entry.items.forEach((item) => {
                            const meta = item.meta !== undefined && item.meta !== null && item.meta !== "" ? `  — ${cell(item.meta)}` : "";
                            lines.push(`- ${cell(item.text)}${meta}`);
                        });
                        lines.push("");
                        break;
                    case "bars":
                        entry.items.forEach((item) => lines.push(`- ${cell(item.label)}: ${cell(item.display)}`));
                        lines.push("");
                        break;
                    case "table":
                        lines.push(...mdTable(entry.columns, entry.rows), "");
                        break;
                    case "raw":
                        lines.push("```json", entry.text, "```", "");
                        break;
                    default:
                        break;
                }
            });

            let markdown = lines
                .join("\n")
                .replace(/\n{3,}/g, "\n\n")
                .trim();

            if (code) {
                markdown += `\n\n### Query\n\n\`\`\`js\n${code.trim()}\n\`\`\``;
            }

            if (notes) {
                const noteLines = collectNotes(markdown);
                if (noteLines.length) {
                    markdown += `\n\n### Notes\n\n${noteLines.join("\n")}`;
                }
            }

            return markdown ? `${markdown}\n` : "";
        }
    }

    // Flatten a cell/label value to inline Markdown text.
    function mdText(value) {
        if (value === undefined || value === null) return "";
        if (value instanceof Date) return stats.formatDate(value);
        return String(value).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
    }

    function mdTable(columns, rows) {
        if (!columns.length) return [];
        const header = `| ${columns.map(mdText).join(" | ")} |`;
        const divider = `| ${columns.map(() => "---").join(" | ")} |`;
        const body = rows.map((row) => `| ${columns.map((_, index) => mdText(row[index])).join(" | ")} |`);
        return [header, divider, ...body];
    }

    // Notes for any activity whose name appears as a whole word in the results.
    function collectNotes(markdown) {
        const haystack = markdown.toLowerCase();
        return Object.keys(ACTIVITY_NOTES)
            .filter((name) => {
                const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                return new RegExp(`(^|[^\\w])${escaped}([^\\w]|$)`).test(haystack);
            })
            .map((name) => `- **${name}:** ${ACTIVITY_NOTES[name]}`);
    }

    function formatCell(value) {
        if (value instanceof Date) return stats.formatDate(value);
        if (typeof value === "number") return stats.round(value, 2);
        return value;
    }

    // ---------------------------------------------------------------------
    // Recipe library
    // ---------------------------------------------------------------------

    function dedent(code) {
        const lines = code.replace(/^\n/, "").replace(/\s+$/, "").split("\n");
        const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length);
        const common = indents.length ? Math.min(...indents) : 0;
        return lines.map((line) => line.slice(common)).join("\n");
    }

    const RECIPES = [
        {
            id: "vocabulary",
            group: "Explore",
            name: "Activity vocabulary",
            code: dedent(`
                // Every activity logged, with totals. Use these exact
                // names in the other recipes. Change the slice() to see more rows.
                const rows = data.activities()
                    .slice(0, 40)
                    .map((a) => [
                        a.name,
                        stats.formatHours(a.hours),
                        a.count,
                        a.days,
                        stats.formatDate(a.last)
                    ]);

                out.heading("Activity vocabulary");
                out.note(data.activities().length + " distinct activity names across " + data.range.totalDays + " days.");
                out.table({ columns: ["Activity", "Total time", "Blocks", "Days", "Last seen"], rows });
            `)
        },
        {
            id: "category-totals",
            group: "Explore",
            name: "Time by category",
            code: dedent(`
                // Total hours grouped by the colour-category of each block.
                const byCategory = stats.groupBy(data.blocks, (b) => b.category);
                const items = [...byCategory.entries()]
                    .map(([category, blocks]) => ({
                        label: category,
                        value: stats.sum(blocks.map((b) => b.hours)),
                        color: blocks[0].color,
                        sub: stats.formatHours(stats.sum(blocks.map((b) => b.hours)))
                    }))
                    .sort((a, b) => b.value - a.value);

                out.heading("Where the time goes");
                out.bars({ items });
            `)
        },
        {
            id: "solo-activities",
            group: "Explore",
            name: "Most-logged solo activities",
            code: dedent(`
                // Activities logged on their own, with no "+" combination.
                // stats.countBy defaults to identity, so a flat list of names counts directly.
                const solo = data.blocks.filter((b) => b.activities.length === 1);

                out.heading("Most frequent solo activities");
                out.bars({
                    items: stats.countBy(solo.flatMap((b) => b.activities))
                        .slice(0, 12)
                        .map(([name, n]) => ({ label: name, value: n, sub: n + "×", color: data.colorOf(name) }))
                });
            `)
        },
        {
            id: "all-nighters",
            group: "Sleep",
            name: "All-nighters (longest awake stretches)",
            code: dedent(`
                // Time between the end of one sleep and the start of the next.
                const sleeps = data.withActivity("Sleep");
                const stretches = [];
                for (let i = 0; i < sleeps.length - 1; i++) {
                    const hours = (sleeps[i + 1].start - sleeps[i].end) / 3600000;
                    if (hours > 0) stretches.push({ hours, from: sleeps[i].end, to: sleeps[i + 1].start });
                }
                stretches.sort((a, b) => b.hours - a.hours);

                out.heading("Longest stretches awake");
                out.stats([
                    { value: stats.formatHours(stretches[0].hours), label: "Longest ever", sub: stats.formatDate(stretches[0].from) },
                    { value: stretches.filter((s) => s.hours >= 43).length, label: "Stretches of 43h+" },
                    { value: stats.formatHours(stats.median(stretches.map((s) => s.hours))), label: "Median gap between sleeps" }
                ]);
                out.table({
                    columns: ["Awake for", "From", "Until"],
                    rows: stretches.slice(0, 10).map((s) => [stats.formatHours(s.hours), stats.formatDateTime(s.from), stats.formatDateTime(s.to)])
                });
            `)
        },
        {
            id: "recovery-sleep",
            group: "Sleep",
            name: "Longest recovery sleeps",
            code: dedent(`
                const sleeps = data.withActivity("Sleep").slice().sort((a, b) => b.hours - a.hours);
                out.heading("Longest single sleeps");
                out.bars({
                    items: sleeps.slice(0, 12).map((s) => ({
                        label: stats.formatDate(s.start),
                        value: s.hours,
                        sub: stats.formatHours(s.hours),
                        color: s.color
                    }))
                });
            `)
        },
        {
            id: "early-crashes",
            group: "Sleep",
            name: "Early crashes (asleep by 5–10 PM)",
            code: dedent(`
                // Nights where sleep began in the early evening — usually a crash.
                const early = data.withActivity("Sleep").filter((s) => s.startMinutes >= 17 * 60 && s.startMinutes < 22 * 60);
                out.heading("Unusually early nights");
                out.stat(early.length, "Nights asleep between 17:00 and 22:00");
                out.table({
                    columns: ["Date", "Asleep at", "Slept for"],
                    rows: early.slice(0, 15).map((s) => [stats.formatDate(s.start), stats.formatClock(s.start), stats.formatHours(s.hours)])
                });
            `)
        },
        {
            id: "before-sleep",
            group: "Correlation",
            name: "What I do before an activity",
            code: dedent(`
                // Which activity most often immediately precedes a chosen activity.
                const ACTIVITY = "Sleep";
                const before = data.precededBy(ACTIVITY);
                const total = stats.sum(before.map(([, count]) => count));
                out.heading("The last thing before " + ACTIVITY);
                out.bars({
                    items: before.slice(0, 12).map(([name, count]) => ({
                        label: name,
                        value: count,
                        sub: count + " times (" + Math.round((count / total) * 100) + "%)",
                        color: data.colorOf(name)
                    }))
                });
            `)
        },
        {
            id: "correlate",
            group: "Correlation",
            name: "Correlate two activities (daily)",
            code: dedent(`
                // Pearson correlation between the daily hours of two activities.
                const A = "Work";
                const B = "Sleep";
                const days = data.calendarDays();
                const xs = days.map((d) => stats.sum(d.blocks.filter((b) => data.has(b, A)).map((b) => b.hours)));
                const ys = days.map((d) => stats.sum(d.blocks.filter((b) => data.has(b, B)).map((b) => b.hours)));
                const r = stats.pearson(xs, ys);

                out.heading("Do " + A + " and " + B + " move together?");
                out.stat(stats.round(r, 2), "Pearson r (daily hours)",
                    r > 0.2 ? "Tend to rise together" : r < -0.2 ? "One rises as the other falls" : "Little linear relationship");
                out.note("r ranges from -1 (opposite) through 0 (unrelated) to +1 (in lockstep). Edit A and B above.");
            `)
        },
        {
            id: "seasonality",
            group: "Seasonality",
            name: "Seasonality by month of year",
            code: dedent(`
                // Average hours per calendar month (Jan–Dec), pooled across years.
                const ACTIVITY = "Class";
                const blocks = data.blocksOf(ACTIVITY);
                const perMonth = Array.from({ length: 12 }, () => ({ hours: 0, years: new Set() }));
                blocks.forEach((b) => { perMonth[b.month].hours += b.hours; perMonth[b.month].years.add(b.year); });

                out.heading("Seasonality of " + ACTIVITY);
                out.bars({
                    items: perMonth.map((m, i) => {
                        const avg = m.years.size ? m.hours / m.years.size : 0;
                        return { label: stats.MONTHS_SHORT[i], value: avg, sub: stats.formatHours(avg), color: data.colorOf(ACTIVITY) };
                    })
                });
                out.note("Bars show average hours in that month across the years it appeared.");
            `)
        },
        {
            id: "weekday-rhythm",
            group: "Seasonality",
            name: "Weekly rhythm by category",
            code: dedent(`
                // Average hours per weekday for one category.
                const CATEGORY = "Productive";
                const color = data.categoryColor(CATEGORY);
                const blocks = data.blocks.filter((b) => b.category === CATEGORY);
                const byDay = Array.from({ length: 7 }, () => ({ hours: 0, days: new Set() }));
                blocks.forEach((b) => { byDay[b.weekday].hours += b.hours; byDay[b.weekday].days.add(b.dayKey); });

                out.heading(CATEGORY + " time by weekday");
                out.bars({
                    items: [1, 2, 3, 4, 5, 6, 0].map((wd) => {
                        const avg = byDay[wd].days.size ? byDay[wd].hours / byDay[wd].days.size : 0;
                        return { label: stats.WEEKDAYS_SHORT[wd], value: avg, sub: stats.formatHours(avg), color };
                    })
                });
                out.note("Try categories like Social, Rest, Unproductive — see the 'Time by category' recipe for names.");
            `)
        },
        {
            id: "median-start",
            group: "Timing",
            name: "Median start time of an activity",
            code: dedent(`
                // When does an activity typically begin? (median + spread + histogram)
                const ACTIVITY = "Class";
                const starts = data.withActivity(ACTIVITY).map((e) => e.startMinutes);
                if (!starts.length) { out.callout("No events found for " + ACTIVITY, "warn"); return; }

                out.heading("When is " + ACTIVITY + "?");
                out.stats([
                    { value: stats.formatClock(stats.median(starts)), label: "Median start" },
                    { value: stats.formatClock(stats.quantile(starts, 0.1)), label: "Earliest 10%" },
                    { value: stats.formatClock(stats.quantile(starts, 0.9)), label: "Latest 10%" },
                    { value: starts.length, label: "Times logged" }
                ]);

                const byHour = Array(24).fill(0);
                starts.forEach((m) => byHour[Math.floor(m / 60)]++);
                out.bars({ items: byHour.map((count, h) => ({ label: String(h).padStart(2, "0") + ":00", value: count, sub: count || "", color: data.colorOf(ACTIVITY) })), format: (v) => v });
            `)
        },
        {
            id: "social-life",
            group: "People",
            name: "Social coverage & longest gap",
            code: dedent(`
                // How much of life is social, and the longest stretch without any.
                const SOCIAL = ["Friends", "Friend", "Family"];
                const days = data.calendarDays();
                const socialHoursByDay = days.map((d) => stats.sum(d.blocks.filter((b) => data.hasAny(b, SOCIAL)).map((b) => b.hours)));
                const socialDays = socialHoursByDay.filter((h) => h > 0).length;

                let gap = 0, longestGap = 0, gapEnd = null;
                days.forEach((d, i) => {
                    if (socialHoursByDay[i] > 0) { gap = 0; }
                    else { gap++; if (gap > longestGap) { longestGap = gap; gapEnd = d.date; } }
                });

                out.heading("Social life");
                out.stats([
                    { value: Math.round((socialDays / days.length) * 100) + "%", label: "Days with any social time" },
                    { value: stats.formatHours(stats.sum(socialHoursByDay) / days.length), label: "Average per day" },
                    { value: longestGap + " days", label: "Longest social drought", sub: gapEnd ? "ended " + stats.formatDate(gapEnd) : "" }
                ]);
            `)
        },
        {
            id: "longest-blocks",
            group: "Records",
            name: "Longest single sessions",
            code: dedent(`
                // The longest continuous events, of any label.
                const longest = data.events.slice().sort((a, b) => b.hours - a.hours).slice(0, 15);
                out.heading("Longest continuous blocks");
                out.table({
                    columns: ["Label", "Duration", "Started"],
                    rows: longest.map((e) => [e.summary, stats.formatHours(e.hours), stats.formatDateTime(e.start)])
                });
            `)
        },
        {
            id: "fragmented-day",
            group: "Records",
            name: "Most fragmented day",
            code: dedent(`
                // The day split into the most separate logged entries.
                const ranked = data.days.slice().sort((a, b) => b.blocks.length - a.blocks.length);
                const top = ranked[0];
                out.heading("Most fragmented day");
                out.stat(top.blocks.length + " entries", stats.formatDate(top.date));
                out.subheading("That day, minute by minute");
                out.list(top.blocks.slice().sort((a, b) => a.start - b.start).map((b) => ({
                    text: stats.formatClock(b.start) + "  " + b.summary,
                    meta: stats.formatHours(b.hours)
                })));
            `)
        }
    ];

    const STARTER_CODE = RECIPES[0].code;

    // ---------------------------------------------------------------------
    // Syntax highlighting
    // ---------------------------------------------------------------------

    const JS_KEYWORDS = new Set(["const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "of", "in", "new", "typeof", "instanceof", "break", "continue", "switch", "case", "default", "try", "catch", "finally", "throw", "await", "async", "yield", "delete", "void", "this", "class", "extends", "super"]);
    const JS_ATOMS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);
    const JS_GLOBALS = new Set(["data", "out", "stats", "Math", "Array", "Object", "Set", "Map", "Date", "JSON", "Number", "String", "Boolean", "console"]);

    function escapeHtml(text) {
        return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
    }

    function scanStringLiteral(code, start) {
        const quote = code[start];
        let i = start + 1;
        while (i < code.length) {
            if (code[i] === "\\") {
                i += 2;
                continue;
            }
            if (code[i] === quote) return i + 1;
            i++;
        }
        return code.length;
    }

    // Offsets of string literals that sit in a "parameter" position — the direct
    // initializer of a const/let/var, optionally inside an array literal. Only
    // these become clickable chips, so an activity name used inline in a call
    // (e.g. data.withActivity("Sleep")) stays locked and can't silently break a
    // recipe whose wording assumes that specific activity.
    function findParameterRanges(code) {
        const ranges = new Set();
        const declaration = /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*/g;
        let match;
        while ((match = declaration.exec(code))) {
            let i = match.index + match[0].length;
            if (code[i] === "[") {
                i++;
                let depth = 1;
                while (i < code.length && depth > 0) {
                    const char = code[i];
                    if (char === "[") {
                        depth++;
                        i++;
                    } else if (char === "]") {
                        depth--;
                        i++;
                    } else if (char === '"' || char === "'" || char === "`") {
                        const end = scanStringLiteral(code, i);
                        ranges.add(`${i}:${end}`);
                        i = end;
                    } else {
                        i++;
                    }
                }
            } else if (code[i] === '"' || code[i] === "'" || code[i] === "`") {
                ranges.add(`${i}:${scanStringLiteral(code, i)}`);
            }
        }
        return ranges;
    }

    // Tokenise a snippet into highlighted HTML. A parameter string literal whose
    // value is a known activity or category becomes a clickable chip (coloured dot
    // + label) carrying its [start, end) offsets and kind, so the picker can splice
    // in a replacement of the same kind. chipFor(value) returns { color, kind } or null.
    function highlight(code, chipFor) {
        const paramRanges = findParameterRanges(code);
        const pattern = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\s])/g;
        let html = "";
        let match;
        while ((match = pattern.exec(code))) {
            const token = match[0];
            const start = match.index;
            if (match[1]) {
                html += `<span class="tok-com">${escapeHtml(token)}</span>`;
            } else if (match[2]) {
                const inner = token.slice(1, -1);
                const info = paramRanges.has(`${start}:${start + token.length}`) ? chipFor(inner) : null;
                if (info) {
                    html += `<span class="tok-entry" contenteditable="false" data-start="${start}" data-end="${start + token.length}" data-name="${escapeHtml(inner)}" data-quote="${escapeHtml(token[0])}" data-kind="${info.kind}">` + `<span class="tok-entry__dot" style="background:${escapeHtml(info.color)}"></span>` + `<span class="tok-str">${escapeHtml(token)}</span></span>`;
                } else {
                    html += `<span class="tok-str">${escapeHtml(token)}</span>`;
                }
            } else if (match[3]) {
                html += `<span class="tok-num">${escapeHtml(token)}</span>`;
            } else if (match[4]) {
                let cls = "tok-id";
                if (JS_KEYWORDS.has(token)) cls = "tok-kw";
                else if (JS_ATOMS.has(token)) cls = "tok-atom";
                else if (JS_GLOBALS.has(token)) cls = "tok-global";
                html += `<span class="${cls}">${escapeHtml(token)}</span>`;
            } else if (match[5]) {
                html += escapeHtml(token);
            } else {
                html += `<span class="tok-punc">${escapeHtml(token)}</span>`;
            }
        }
        return html;
    }

    // ---------------------------------------------------------------------
    // Code editor (contenteditable + live highlighting + clickable chips)
    // ---------------------------------------------------------------------

    function createEditor(root, { chipFor, onChange, onEntryClick, onRun }) {
        let code = "";
        let composing = false;

        function readText() {
            return root.textContent;
        }

        function caretOffset() {
            const selection = window.getSelection();
            if (!selection.rangeCount) return null;
            const range = selection.getRangeAt(0);
            if (!root.contains(range.startContainer)) return null;
            const measure = range.cloneRange();
            measure.selectNodeContents(root);
            measure.setEnd(range.startContainer, range.startOffset);
            return measure.toString().length;
        }

        function placeCaret(offset) {
            if (offset == null) return;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let remaining = offset;
            let node;
            const range = document.createRange();
            while ((node = walker.nextNode())) {
                const len = node.nodeValue.length;
                if (remaining <= len) {
                    range.setStart(node, remaining);
                    range.collapse(true);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    return;
                }
                remaining -= len;
            }
            range.selectNodeContents(root);
            range.collapse(false);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }

        function paint({ keepCaret = false } = {}) {
            const offset = keepCaret ? caretOffset() : null;
            root.innerHTML = highlight(code, chipFor);
            if (keepCaret) placeCaret(offset);
        }

        function syncFromDom() {
            code = readText();
            paint({ keepCaret: true });
            if (onChange) onChange(code);
        }

        function insertText(text) {
            const selection = window.getSelection();
            if (!selection.rangeCount) return;
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const node = document.createTextNode(text);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            syncFromDom();
        }

        root.addEventListener("input", () => {
            if (composing) return;
            syncFromDom();
        });
        root.addEventListener("compositionstart", () => {
            composing = true;
        });
        root.addEventListener("compositionend", () => {
            composing = false;
            syncFromDom();
        });
        root.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                if (onRun) onRun(code);
            } else if (event.key === "Enter") {
                event.preventDefault();
                insertText("\n");
            } else if (event.key === "Tab") {
                event.preventDefault();
                insertText("    ");
            }
        });
        root.addEventListener("paste", (event) => {
            event.preventDefault();
            const text = (event.clipboardData || window.clipboardData).getData("text");
            insertText(text);
        });
        root.addEventListener("click", (event) => {
            const chip = event.target.closest(".tok-entry");
            if (chip && onEntryClick) {
                event.preventDefault();
                onEntryClick(chip, code);
            }
        });

        return {
            getCode: () => code,
            setCode(next) {
                code = next;
                paint();
                if (onChange) onChange(code);
            },
            replaceRange(start, end, text) {
                code = code.slice(0, start) + text + code.slice(end);
                paint();
                if (onChange) onChange(code);
                return code;
            },
            focus: () => root.focus()
        };
    }

    // ---------------------------------------------------------------------
    // Activity picker (shared by editor chips)
    // ---------------------------------------------------------------------

    let activePicker = null;
    // Width when the picker opened. On mobile, focusing the search field pops up
    // the on-screen keyboard, which fires a `resize` (the visual viewport gets
    // shorter). We must NOT treat that as a real resize — otherwise the picker
    // closes the instant the keyboard appears. Only a width change (rotation, a
    // genuine window resize) should dismiss the anchored popover.
    let pickerViewportWidth = 0;
    // When the picker opened. Mobile keyboards can also emit a transient scroll as
    // they animate in; ignore scroll/resize for a moment so it doesn't self-close.
    let pickerOpenedAt = 0;

    function closePicker() {
        if (activePicker) {
            activePicker.remove();
            activePicker = null;
            document.removeEventListener("mousedown", onPickerOutside, true);
            window.removeEventListener("resize", onPickerResize);
            window.removeEventListener("scroll", onPickerScroll, true);
        }
    }

    function onPickerResize() {
        if (Date.now() - pickerOpenedAt < 400) return;
        if (window.innerWidth !== pickerViewportWidth) closePicker();
    }

    function onPickerOutside(event) {
        if (activePicker && !activePicker.contains(event.target)) closePicker();
    }

    // Close when the page scrolls (the popover is anchored), but ignore scrolling
    // inside the picker's own list.
    function onPickerScroll(event) {
        if (Date.now() - pickerOpenedAt < 400) return;
        if (activePicker && event.target && activePicker.contains(event.target)) return;
        closePicker();
    }

    // Generic searchable popover. `items` are { name, color, meta } records; the
    // chosen name (or a typed custom value) is passed to onPick.
    function openPicker(anchor, currentName, items, { placeholder = "Search…", emptyText = "No matches." } = {}, onPick) {
        closePicker();
        const menu = el("div", "insights-picker");
        const search = el("input", "insights-picker__search");
        search.type = "text";
        search.placeholder = placeholder;
        menu.appendChild(search);
        const listWrap = el("div", "insights-picker__list");
        menu.appendChild(listWrap);

        function choose(name) {
            onPick(name);
            closePicker();
        }

        function renderList(term) {
            listWrap.replaceChildren();
            const needle = term.trim().toLowerCase();
            const matches = items.filter((item) => item.name.toLowerCase().includes(needle));
            matches.slice(0, 60).forEach((item) => {
                const option = el("button", "insights-picker__opt");
                option.type = "button";
                if (item.name === currentName) option.classList.add("is-active");
                const dot = el("span", "insights-dot");
                dot.style.backgroundColor = item.color;
                option.appendChild(dot);
                option.appendChild(el("span", "insights-picker__name", item.name));
                if (item.meta !== undefined) option.appendChild(el("span", "insights-picker__meta", item.meta));
                option.addEventListener("click", () => choose(item.name));
                listWrap.appendChild(option);
            });
            const exact = matches.some((item) => item.name.toLowerCase() === needle);
            if (needle && !exact) {
                const custom = el("button", "insights-picker__opt insights-picker__opt--custom");
                custom.type = "button";
                custom.textContent = `Use “${term.trim()}”`;
                custom.addEventListener("click", () => choose(term.trim()));
                listWrap.appendChild(custom);
            }
            if (!listWrap.childNodes.length) listWrap.appendChild(el("div", "insights-picker__empty", emptyText));
        }

        search.addEventListener("input", () => renderList(search.value));
        search.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                const first = listWrap.querySelector(".insights-picker__opt");
                if (first) first.click();
            } else if (event.key === "Escape") {
                closePicker();
            }
        });

        renderList("");
        document.body.appendChild(menu);

        const rect = anchor.getBoundingClientRect();
        const width = menu.offsetWidth || 260;
        menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 12)}px`;
        menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;

        activePicker = menu;
        pickerViewportWidth = window.innerWidth;
        pickerOpenedAt = Date.now();
        setTimeout(() => search.focus(), 0);
        document.addEventListener("mousedown", onPickerOutside, true);
        window.addEventListener("resize", onPickerResize);
        window.addEventListener("scroll", onPickerScroll, true);
    }

    // Placeholder labels that should never appear as a selectable option.
    const UNSELECTABLE_ACTIVITIES = new Set(["?", "untitled", "unknown"]);
    const UNSELECTABLE_CATEGORIES = new Set(["not specified"]);

    // Open the right picker for a chip based on its kind (activity or category).
    function openChipPicker(chip, onPick) {
        const kind = chip.dataset.kind === "category" ? "category" : "activity";
        const source = kind === "category" ? dataset.categories() : dataset.activities();
        const excluded = kind === "category" ? UNSELECTABLE_CATEGORIES : UNSELECTABLE_ACTIVITIES;
        const items = source.filter((entry) => !excluded.has(entry.name.trim().toLowerCase())).map((entry) => ({ name: entry.name, color: entry.color, meta: stats.formatHours(entry.hours) }));
        openPicker(chip, chip.dataset.name, items, { placeholder: `Search ${kind === "category" ? "categories" : "activities"}…`, emptyText: `No ${kind === "category" ? "categories" : "activities"} match.` }, onPick);
    }

    // ---------------------------------------------------------------------
    // Custom query storage
    // ---------------------------------------------------------------------

    const STORAGE_KEY = "insightsLab.customQueries.v1";

    function loadCustomQueries() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function persistCustomQueries(list) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch (error) {
            /* storage unavailable (private mode, quota) — silently skip */
        }
    }

    // ---------------------------------------------------------------------
    // UI wiring
    // ---------------------------------------------------------------------

    let dataset = null;
    let report = null;
    let editor = null;
    let elements = null;
    let activeId = null;
    let galleryExpanded = false;
    const VISIBLE_CARDS = 6;

    function runCode(code) {
        if (!report) return;
        report.clear();
        let returned;
        try {
            const fn = new Function("data", "out", "stats", `"use strict";\n${code}`);
            returned = fn(dataset, report, stats);
        } catch (error) {
            report.error(error);
            return;
        }
        if (!report.hasContent() && returned !== undefined) report.auto(returned);
        if (!report.hasContent()) report.note("Ran with no output. Use out.heading(), out.bars(), out.table(), … to render results.");
    }

    let copyFeedbackTimer = null;

    function flashCopyLabel(text) {
        if (!elements.copyLabel) return;
        elements.copyLabel.textContent = text;
        clearTimeout(copyFeedbackTimer);
        copyFeedbackTimer = setTimeout(() => {
            elements.copyLabel.textContent = "Copy as Markdown";
        }, 1600);
    }

    async function copyResultsAsMarkdown() {
        if (!report) return;
        const markdown = report.toMarkdown({
            code: elements.copyCode.checked ? editor.getCode() : null,
            notes: elements.copyNotes.checked
        });
        if (!markdown.trim()) {
            flashCopyLabel("Nothing to copy");
            return;
        }
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(markdown);
            } else {
                const area = document.createElement("textarea");
                area.value = markdown;
                area.style.position = "fixed";
                area.style.opacity = "0";
                document.body.appendChild(area);
                area.select();
                document.execCommand("copy");
                area.remove();
            }
            flashCopyLabel("Copied!");
        } catch (error) {
            flashCopyLabel("Copy failed");
        }
    }

    function allRecipes() {
        const custom = loadCustomQueries().map((query) => ({ ...query, group: "Custom", custom: true }));
        return [...RECIPES, ...custom];
    }

    function findRecipe(id) {
        return allRecipes().find((recipe) => recipe.id === id);
    }

    function selectRecipe(recipe, { run = true } = {}) {
        if (!recipe) return;
        activeId = recipe.id;
        editor.setCode(recipe.code);
        renderGallery();
        if (run) runCode(recipe.code);
    }

    function renderGallery() {
        const recipes = allRecipes();
        elements.gallery.replaceChildren();

        recipes.forEach((recipe, index) => {
            const card = el("div", "insights-inner-card");
            card.tabIndex = 0;
            card.setAttribute("role", "button");
            if (recipe.id === activeId) card.classList.add("is-active");
            if (!galleryExpanded && index >= VISIBLE_CARDS) card.classList.add("hidden");

            const tag = el("span", `insights-inner-card__tag${recipe.custom ? " insights-inner-card__tag--custom" : ""}`, recipe.group);
            card.appendChild(tag);
            card.appendChild(el("span", "insights-inner-card__name", recipe.name));

            if (recipe.custom) {
                const remove = el("button", "insights-inner-card__delete");
                remove.type = "button";
                remove.title = "Delete saved query";
                remove.textContent = "×";
                remove.addEventListener("click", (event) => {
                    event.stopPropagation();
                    deleteCustomQuery(recipe.id);
                });
                card.appendChild(remove);
            }

            const activate = () => selectRecipe(recipe);
            card.addEventListener("click", activate);
            card.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                }
            });

            elements.gallery.appendChild(card);
        });

        const overflow = recipes.length - VISIBLE_CARDS;
        elements.galleryToggle.classList.toggle("hidden", overflow <= 0);
        elements.galleryToggle.textContent = galleryExpanded ? "Show fewer" : `Show all ${recipes.length}`;
    }

    function saveCurrentQuery() {
        const name = (elements.saveInput.value || "").trim();
        if (!name) {
            elements.saveInput.focus();
            return;
        }
        const list = loadCustomQueries();
        const id = `custom-${Date.now()}`;
        list.push({ id, name, code: editor.getCode() });
        persistCustomQueries(list);
        activeId = id;
        closeSaveRow();
        renderGallery();
    }

    function deleteCustomQuery(id) {
        persistCustomQueries(loadCustomQueries().filter((query) => query.id !== id));
        if (activeId === id) activeId = RECIPES[0].id;
        renderGallery();
    }

    function openSaveRow() {
        elements.saveRow.classList.remove("hidden");
        elements.saveInput.value = "";
        elements.saveInput.focus();
    }

    function closeSaveRow() {
        elements.saveRow.classList.add("hidden");
    }

    function init(meta) {
        const section = document.getElementById("insightsSection");
        if (!section) return;

        elements = {
            gallery: document.getElementById("insightsGallery"),
            galleryToggle: document.getElementById("insightsGalleryToggle"),
            editorRoot: document.getElementById("insightsCode"),
            runButton: document.getElementById("insightsRun"),
            resetButton: document.getElementById("insightsReset"),
            saveButton: document.getElementById("insightsSave"),
            saveRow: document.getElementById("insightsSaveRow"),
            saveInput: document.getElementById("insightsSaveName"),
            saveConfirm: document.getElementById("insightsSaveConfirm"),
            saveCancel: document.getElementById("insightsSaveCancel"),
            output: document.getElementById("insightsOutput"),
            copyButton: document.getElementById("insightsCopyMd"),
            copyLabel: document.getElementById("insightsCopyMdLabel"),
            copyCode: document.getElementById("insightsCopyCode"),
            copyNotes: document.getElementById("insightsCopyNotes")
        };
        if (Object.values(elements).some((node) => !node)) return;

        dataset = new CalendarDataset(meta.events, meta);
        report = new Report(elements.output, { entryColor: (name) => dataset.entryColor(name) || dataset.categoryColor(name) });

        editor = createEditor(elements.editorRoot, {
            chipFor: (name) => {
                const activityColor = dataset.entryColor(name);
                if (activityColor) return { color: activityColor, kind: "activity" };
                const categoryColor = dataset.categoryColor(name);
                if (categoryColor) return { color: categoryColor, kind: "category" };
                return null;
            },
            onRun: (code) => runCode(code),
            onEntryClick: (chip) => {
                const start = Number(chip.dataset.start);
                const end = Number(chip.dataset.end);
                const quote = chip.dataset.quote || '"';
                openChipPicker(chip, (name) => {
                    const next = editor.replaceRange(start, end, `${quote}${name}${quote}`);
                    runCode(next);
                });
            }
        });

        activeId = RECIPES[0].id;
        editor.setCode(STARTER_CODE);
        renderGallery();

        elements.runButton.addEventListener("click", () => runCode(editor.getCode()));
        elements.resetButton.addEventListener("click", () => {
            const recipe = findRecipe(activeId);
            if (recipe) selectRecipe(recipe);
        });
        elements.galleryToggle.addEventListener("click", () => {
            galleryExpanded = !galleryExpanded;
            renderGallery();
        });
        elements.copyButton.addEventListener("click", copyResultsAsMarkdown);
        elements.saveButton.addEventListener("click", openSaveRow);
        elements.saveConfirm.addEventListener("click", saveCurrentQuery);
        elements.saveCancel.addEventListener("click", closeSaveRow);
        elements.saveInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                saveCurrentQuery();
            } else if (event.key === "Escape") {
                closeSaveRow();
            }
        });

        section.classList.remove("hidden");
        runCode(STARTER_CODE);
    }

    window.CalendarInsights = { init, CalendarDataset, Report, stats, recipes: RECIPES };
})();
