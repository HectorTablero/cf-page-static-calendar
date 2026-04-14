let originalEvents = [];
const calendarDiv = document.getElementById("calendar");
const calendarLoading = document.getElementById("calendarLoading");
const calendarTooltip = document.getElementById("calendarTooltip");
const overviewCtx = document.getElementById("chart").getContext("2d");
const timelineCtx = document.getElementById("timelineChart").getContext("2d");
const words = {};
const hexLightness = 50;
let overviewChart;
let timelineChart;
let isFilter = false;
let analyticsScopeSelection = {
    kind: "all",
    value: "all",
    label: "All activities"
};
const analyticsPalette = ["#2563eb", "#14b8a6", "#f97316", "#8b5cf6", "#ef4444", "#22c55e", "#0ea5e9", "#f59e0b"];
const colors = {
    1: "#b0c4de", // neutral
    2: "#aee4c4", // mid-prod
    3: "#d0b1da", // social
    4: "#f7c2a4", // mid-unprod
    5: "#f9dd9b", // mix
    6: "#000", // (orange)
    7: "#000", // (aqua)
    8: "#b0b0b0", // rest
    9: "#98a8cf", // social-prod
    10: "#9fbeaa", // prod
    11: "#e5a4a5", // unprod
    default: "#e0e0e0" // not specified
};

function setCalendarLoadingState(isLoading, message = "Loading calendar data...") {
    if (calendarLoading) {
        calendarLoading.classList.toggle("hidden", !isLoading);
        calendarLoading.textContent = message;
        if (isLoading) {
            const spinner = document.createElement("span");
            spinner.className = "spinner";
            calendarLoading.textContent = "";
            calendarLoading.appendChild(spinner);
            const text = document.createElement("span");
            text.textContent = message;
            calendarLoading.appendChild(text);
        }
    }

    calendarDiv.classList.toggle("hidden", isLoading);
}

function showCalendarTooltip(text, clientX, clientY) {
    if (!calendarTooltip) return;

    const [titleText, ...detailLines] = String(text).split("\n");
    const title = document.createElement("div");
    title.className = "calendar-tooltip__title";
    title.textContent = titleText;

    calendarTooltip.replaceChildren(title);

    if (detailLines.length) {
        const details = document.createElement("div");
        details.className = "calendar-tooltip__details";
        details.textContent = detailLines.join("\n");
        calendarTooltip.appendChild(details);
    }

    calendarTooltip.classList.remove("hidden");
    positionCalendarTooltip(clientX, clientY);
}

function positionCalendarTooltip(clientX, clientY) {
    if (!calendarTooltip || calendarTooltip.classList.contains("hidden")) return;

    const offsetX = 16;
    const offsetY = 18;
    const tooltipWidth = calendarTooltip.offsetWidth || 260;
    const tooltipHeight = calendarTooltip.offsetHeight || 120;

    let left = clientX + offsetX;
    let top = clientY + offsetY;

    if (left + tooltipWidth > window.innerWidth - 12) left = clientX - tooltipWidth - offsetX;
    if (top + tooltipHeight > window.innerHeight - 12) top = clientY - tooltipHeight - offsetY;

    calendarTooltip.style.left = `${Math.max(12, left)}px`;
    calendarTooltip.style.top = `${Math.max(12, top)}px`;
}

function hideCalendarTooltip() {
    if (!calendarTooltip) return;
    calendarTooltip.classList.add("hidden");
}

function scrollCalendarToEnd() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            calendarDiv.scrollLeft = calendarDiv.scrollWidth;
        });
    });
}

function getColor(colorId) {
    return colorId ? colors[colorId] || colors.default : colors.default;
}

function extractDataFromEvent(event) {
    return {
        summary: event.summary || "?",
        color: getColor(event.colorId),
        start: event.start,
        end: event.end
    };
}

function processEvent(event) {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);

    if (start.toDateString() === end.toDateString()) {
        return [extractDataFromEvent(event)];
    }

    const splitEvents = [];

    // First part – not a continuation.
    const firstDayEnd = new Date(start);
    firstDayEnd.setDate(firstDayEnd.getDate() + 1);
    firstDayEnd.setHours(0, 0, 0, 0);
    splitEvents.push({
        ...extractDataFromEvent(event),
        end: {
            dateTime: firstDayEnd.toISOString(),
            timeZone: event.start.timeZone
        },
        trueEnd: {
            dateTime: end.toISOString(),
            timeZone: event.end.timeZone
        },
        continuation: false
    });

    let currentDayStart = new Date(firstDayEnd);
    while (currentDayStart < end) {
        const currentDayEnd = new Date(currentDayStart);
        currentDayEnd.setDate(currentDayEnd.getDate() + 1);
        currentDayEnd.setHours(0, 0, 0, 0);

        splitEvents.push({
            ...extractDataFromEvent(event),
            start: {
                dateTime: currentDayStart.toISOString(),
                timeZone: event.start.timeZone
            },
            trueStart: {
                dateTime: start.toISOString(),
                timeZone: event.start.timeZone
            },
            end: {
                dateTime: (currentDayEnd < end ? currentDayEnd : end).toISOString(),
                timeZone: event.end.timeZone
            },
            trueEnd: {
                dateTime: end.toISOString(),
                timeZone: event.end.timeZone
            },
            continuation: true
        });

        currentDayStart = new Date(currentDayEnd);
    }

    return splitEvents;
}

async function fetchData() {
    setCalendarLoadingState(true);

    try {
        const response = await fetch("https://workers.tablerus.es/calendar/everything");
        if (!response.ok) throw new Error("Network response error");

        const decompressedResponse = LZString.decompressFromBase64(await response.text());

        originalEvents = JSON.parse(decompressedResponse).flatMap(processEvent);

        const eventsByMonth = {};
        originalEvents.forEach((event) => {
            const d = new Date(event.start.dateTime);
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            if (!eventsByMonth[key]) {
                eventsByMonth[key] = { nonContinuation: 0 };
            }
            if (!event.continuation) {
                eventsByMonth[key].nonContinuation++;
            }
        });

        originalEvents = originalEvents.filter((event) => {
            const d = new Date(event.start.dateTime);
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            if (event.continuation && eventsByMonth[key].nonContinuation === 0) {
                return false;
            }
            return true;
        });

        return true;
    } catch (error) {
        console.error("Fetch error:", error);
        if (calendarLoading) {
            setCalendarLoadingState(true, "Unable to load calendar data.");
        }
        return false;
    }
}

function renderDay(dateD) {
    const dayEvents = originalEvents.filter((event) => {
        const eventDate = new Date(event.start.dateTime);
        return eventDate.getFullYear() === dateD.getFullYear() && eventDate.getMonth() === dateD.getMonth() && eventDate.getDate() === dateD.getDate();
    });
    const div = document.createElement("div");
    div.classList.add("dayContainer");

    const p = document.createElement("p");
    p.classList.add("text-center");
    p.innerText = dateD.getDate();
    div.appendChild(p);

    const hr = document.createElement("hr");
    hr.classList.add("mb-1");
    div.appendChild(hr);

    dayEvents.forEach((event) => {
        const startTime = new Date(event.trueStart ? event.trueStart.dateTime : event.start.dateTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
        const endTime = new Date(event.trueEnd ? event.trueEnd.dateTime : event.end.dateTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
        const duration = (new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime()) / 60000;

        const outerDiv = document.createElement("div");
        outerDiv.classList.add("eventOuter");
        outerDiv.style.flex = duration;
        div.appendChild(outerDiv);

        const innerDiv = document.createElement("div");
        innerDiv.classList.add("eventInner");
        innerDiv.style.backgroundColor = event.color;
        outerDiv.appendChild(innerDiv);

        if (duration < 90) {
            const tooltipText = `${event.summary}\n${startTime} - ${endTime}`;
            innerDiv.addEventListener("mouseenter", (eventMouse) => {
                showCalendarTooltip(tooltipText, eventMouse.clientX, eventMouse.clientY);
            });
            innerDiv.addEventListener("mousemove", (eventMouse) => {
                positionCalendarTooltip(eventMouse.clientX, eventMouse.clientY);
            });
            innerDiv.addEventListener("mouseleave", hideCalendarTooltip);
        }

        const title = document.createElement("h4");
        title.innerText = event.summary;
        innerDiv.appendChild(title);

        const time = document.createElement("p");
        time.innerText = `${startTime} - ${endTime}`;
        innerDiv.appendChild(time);

        const data = [event.summary, title, event.color];
        event.summary.split("+").forEach((word) => {
            word = word.trim();
            if (!words[word]) words[word] = [];
            words[word].push(data);
        });

        event.div = outerDiv;

        if (event.summary.indexOf("+") === -1 && event.summary.trim() !== "?" && event.color !== colors.default) {
            innerDiv.style.cursor = "pointer";
            innerDiv.addEventListener("click", () => {
                const selectedTitle = document.getElementById("selectedTitle").textContent.trim().toLowerCase();
                const escapedSummary = escapeAttributeValue(event.summary);
                const selector = `[data-value="${escapedSummary}"]`;
                if (selectedTitle === event.summary.trim().toLowerCase()) document.getElementById("titleOptions").childNodes[0].click();
                else document.getElementById("titleOptions").querySelector(selector)?.click();

                const matchingScope = getAnalyticsScopeOptions().find((option) => option.kind === "activity" && option.value.trim().toLowerCase() === event.summary.trim().toLowerCase());
                if (matchingScope) setAnalyticsScopeSelection(matchingScope);
            });
        } else innerDiv.style.cursor = "not-allowed";
    });

    return div;
}

function renderMonth(dateM) {
    const div = document.createElement("div");
    div.classList.add("relative");

    const titleBar = document.createElement("div");
    titleBar.classList.add("stickyMonthTitleBar");

    const h2 = document.createElement("h2");
    h2.classList.add("stickyMonthTitle");
    h2.innerHTML = `<strong>${new Date(dateM.getFullYear(), dateM.getMonth(), 1).toLocaleString("default", {
        month: "long"
    })}</strong> ${dateM.getFullYear()}`;
    titleBar.appendChild(h2);
    div.appendChild(titleBar);

    const startDate = new Date(dateM);
    const endDate = new Date(dateM);
    endDate.setMonth(endDate.getMonth() + 1);
    h2.addEventListener("click", () => {
        const inputStartDate = document.getElementById("startDate").value;
        const inputEndDate = document.getElementById("endDate").value;
        const formattedStart = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-01T00:00`;
        const formattedEnd = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-01T00:00`;
        if (inputStartDate === formattedStart && inputEndDate === formattedEnd) {
            document.getElementById("startDate").value = "";
            document.getElementById("endDate").value = "";
            updateChart();
        } else {
            document.getElementById("startDate").value = formattedStart;
            document.getElementById("endDate").value = formattedEnd;
            updateChart();
        }
    });

    const monthDiv = document.createElement("div");
    monthDiv.classList.add("monthContainer");
    div.appendChild(monthDiv);

    const date = new Date(dateM);
    while (date.getMonth() === dateM.getMonth()) {
        monthDiv.appendChild(renderDay(date));
        date.setDate(date.getDate() + 1);
    }

    return div;
}

function renderCalendar(events) {
    if (!events.length) {
        return;
    }

    const firstEventDate = new Date(events[0].start.dateTime);
    const lastEventDate = new Date(events[events.length - 1].start.dateTime);
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);

    const currentDate = new Date(firstEventDate.getFullYear(), firstEventDate.getMonth(), 1);
    const lastRenderableMonth = new Date(lastEventDate.getFullYear(), lastEventDate.getMonth(), 1);

    if (lastRenderableMonth >= currentMonthStart) {
        lastRenderableMonth.setMonth(lastRenderableMonth.getMonth() - 1);
    }

    if (lastRenderableMonth < currentDate) {
        return;
    }

    while (currentDate <= lastRenderableMonth) {
        calendarDiv.appendChild(renderMonth(currentDate));
        currentDate.setMonth(currentDate.getMonth() + 1);
    }
}

let addModificationBtn = document.getElementById("addModificationBtn");
if (addModificationBtn) {
    addModificationBtn.addEventListener("click", addModification);
}
function addModification(filter, replace) {
    const modificationDiv = document.createElement("div");
    modificationDiv.className = "modification flex gap-2 items-center";

    // Create custom dropdown container
    const dropdownContainer = document.createElement("div");
    dropdownContainer.className = "relative";

    // Create dropdown button that shows selected value
    const dropdownButton = document.createElement("button");
    dropdownButton.className = "mod-dropdown-button";

    const selectedDot = document.createElement("div");
    selectedDot.className = "w-3 h-3 rounded-full hidden";
    dropdownButton.appendChild(selectedDot);

    const buttonText = document.createElement("span");
    buttonText.className = "mod-filter-label";
    buttonText.textContent = "Select a filter...";
    dropdownButton.appendChild(buttonText);

    // Create dropdown menu
    const dropdownMenu = document.createElement("div");
    dropdownMenu.className = "dropdown-menu hidden";

    // Create search input
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "dropdown-search";
    searchInput.placeholder = "Search...";
    dropdownMenu.appendChild(searchInput);

    // Create options container
    const optionsContainer = document.createElement("div");
    optionsContainer.className = "dropdown-options";
    dropdownMenu.appendChild(optionsContainer);

    let lastModification = "";
    let lastReplaceValue = "";

    const updateOptions = (searchTerm = "") => {
        optionsContainer.innerHTML = "";
        Object.keys(words)
            .filter((key) => key.toLowerCase().includes(searchTerm.toLowerCase()) && words[key][0][2] !== colors.default && key !== "?")
            .forEach((key) => {
                const option = document.createElement("div");
                option.className = "flex items-center gap-2 cursor-pointer";

                const dot = document.createElement("div");
                dot.className = "w-3 h-3 rounded-full";
                dot.style.backgroundColor = getMostCommonColor(key);
                option.appendChild(dot);

                const text = document.createElement("span");
                text.textContent = key;
                option.appendChild(text);

                const onclick = () => {
                    buttonText.textContent = key;
                    selectedDot.style.backgroundColor = getMostCommonColor(key);
                    selectedDot.classList.remove("hidden");
                    dropdownMenu.classList.add("hidden");
                    applyModification(lastModification, lastModification);
                    applyModification(key, replaceInput.value);
                    const titleText = document.getElementById("selectedTitle").textContent;
                    const title = (titleText === "Select title..." ? "" : titleText).trim();
                    if (lastModification === title || key === title || lastReplaceValue === title) updateChart();
                    lastModification = key;
                };

                if (key === filter) onclick();

                option.addEventListener("click", onclick);

                optionsContainer.appendChild(option);
            });
    };

    // Toggle dropdown
    dropdownButton.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle("hidden");
        if (!dropdownMenu.classList.contains("hidden")) {
            searchInput.focus();
        }
    });

    // Handle search
    searchInput.addEventListener("input", (e) => {
        updateOptions(e.target.value);
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", () => {
        dropdownMenu.classList.add("hidden");
    });

    dropdownMenu.addEventListener("click", (e) => {
        e.stopPropagation();
    });

    // Create replace input
    const replaceInput = document.createElement("input");
    replaceInput.type = "text";
    replaceInput.className = "mod-replace-input";
    replaceInput.placeholder = "Replace with...";
    replaceInput.value = replace || "";

    // Create remove button
    const removeButton = document.createElement("button");
    removeButton.className = "mod-remove-button";
    removeButton.textContent = "×";
    removeButton.onclick = () => {
        applyModification(lastModification, lastModification);
        const titleText = document.getElementById("selectedTitle").textContent;
        const title = (titleText === "Select title..." ? "" : titleText).trim();
        modificationDiv.remove();
        document.dispatchEvent(new Event("validatetitle"));
        if (lastReplaceValue === title) updateChart();
    };

    // Handle replace input changes
    replaceInput.addEventListener("input", (e) => {
        const selectedValue = buttonText.textContent;
        if (selectedValue !== "Select a filter...") {
            const newReplaceValue = e.target.value.trim();
            applyModification(selectedValue, newReplaceValue);
            document.dispatchEvent(new Event("validatetitle"));
            const titleText = document.getElementById("selectedTitle").textContent;
            const title = titleText === "Select title..." ? "" : titleText;
            if (lastReplaceValue === title || newReplaceValue === title) updateChart();
            lastModification = selectedValue;
            lastReplaceValue = newReplaceValue;
        }
    });

    // Initial population of options
    updateOptions();

    // Assemble the components
    dropdownContainer.appendChild(dropdownButton);
    dropdownContainer.appendChild(dropdownMenu);
    modificationDiv.appendChild(dropdownContainer);
    modificationDiv.appendChild(replaceInput);
    modificationDiv.appendChild(removeButton);
    document.getElementById("modifications").appendChild(modificationDiv);
}

function applyModification(filter, replaceValue) {
    if (!filter || filter === "Select a filter...") return;

    const regex = new RegExp(escapeRegExp(filter), "g");
    (words[filter] || []).forEach(([originalText, element]) => {
        element.innerText = originalText.replace(regex, replaceValue || filter);
    });
}

function getMostCommonColor(key, retNum) {
    const overrides = {
        youtube: "#e5a4a5", // red
        discord: "#e5a4a5", // red
        game: "#e5a4a5", // red
        anime: "#e5a4a5", // red
        "social media": "#e5a4a5", // red
        tv: "#e5a4a5", // red
        breakfast: "#b0c4de", // lightblue
        lunch: "#b0c4de", // lightblue
        dinner: "#b0c4de", // lightblue
        emails: "#b0c4de" // lightblue
    };
    if (overrides[key.toLowerCase()]) return adjustHexLightness(overrides[key.toLowerCase()], hexLightness);
    const colorCounts = {};
    words[key].forEach(([_, __, color]) => {
        colorCounts[color] = (colorCounts[color] || 0) + 1;
    });

    const mostCommon = Object.keys(colorCounts).reduce((a, b) => (colorCounts[a] > colorCounts[b] ? a : b));
    if (retNum) return [adjustHexLightness(mostCommon, hexLightness), colorCounts[mostCommon]];
    return adjustHexLightness(mostCommon, hexLightness);
}

function hexToHSL(hex) {
    hex = hex.replace(/^#/, "");

    let r = parseInt(hex.substring(0, 2), 16) / 255;
    let g = parseInt(hex.substring(2, 4), 16) / 255;
    let b = parseInt(hex.substring(4, 6), 16) / 255;

    let max = Math.max(r, g, b),
        min = Math.min(r, g, b);
    let h,
        s,
        l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }
        h /= 6;
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;

    let c = (1 - Math.abs(2 * l - 1)) * s;
    let x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    let m = l - c / 2;
    let r, g, b;

    if (0 <= h && h < 60) {
        r = c;
        g = x;
        b = 0;
    } else if (60 <= h && h < 120) {
        r = x;
        g = c;
        b = 0;
    } else if (120 <= h && h < 180) {
        r = 0;
        g = c;
        b = x;
    } else if (180 <= h && h < 240) {
        r = 0;
        g = x;
        b = c;
    } else if (240 <= h && h < 300) {
        r = x;
        g = 0;
        b = c;
    } else {
        r = c;
        g = 0;
        b = x;
    }

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
}

function adjustHexLightness(hex, l = 60) {
    const hsl = hexToHSL(hex);
    return hslToHex(hsl.h, hsl.s, l);
}

function formatDurationHours(hours) {
    if (!Number.isFinite(hours)) return "0h";

    const rounded = Math.round(hours * 10) / 10;
    if (rounded < 1) return `${Math.round(rounded * 60)}m`;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

function formatDurationTooltip(hours) {
    if (!Number.isFinite(hours)) return "0 hours 0 minutes";

    const roundedHours = Math.floor(hours);
    const minutes = Math.round((hours - roundedHours) * 60);
    return `${roundedHours} hours ${minutes} minutes`;
}

function getEventDurationHours(event) {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    return (end - start) / (1000 * 60 * 60);
}

function getMonthKeyFromDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabelFromKey(monthKey) {
    const [year, month] = monthKey.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleString("default", {
        month: "short",
        year: "numeric"
    });
}

function getMonthKeys(events) {
    if (!events.length) return [];

    const sortedDates = events.map((event) => new Date(event.start.dateTime)).sort((a, b) => a - b);
    const firstDate = new Date(sortedDates[0].getFullYear(), sortedDates[0].getMonth(), 1);
    const lastDate = new Date(sortedDates[sortedDates.length - 1].getFullYear(), sortedDates[sortedDates.length - 1].getMonth(), 1);
    const keys = [];
    const current = new Date(firstDate);

    while (current <= lastDate) {
        keys.push(getMonthKeyFromDate(current));
        current.setMonth(current.getMonth() + 1);
    }

    return keys;
}

function splitEventSummary(summary) {
    return summary
        .split("+")
        .map((part) => part.trim())
        .filter(Boolean);
}

function getCustomGroups() {
    const customGroups = new Map();

    document.querySelectorAll(".modification").forEach((mod) => {
        const sourceTitle = (mod.querySelector(".mod-filter-label")?.textContent || "").trim();
        const replaceValue = mod.querySelector(".mod-replace-input")?.value.trim();

        if (!sourceTitle || sourceTitle === "Select a filter..." || !replaceValue) return;
        if (isHiddenActivityTitle(replaceValue)) return;

        const normalizedGroup = replaceValue.toLowerCase();
        if (!customGroups.has(normalizedGroup)) customGroups.set(normalizedGroup, { label: replaceValue, titles: new Set() });
        customGroups.get(normalizedGroup).titles.add(sourceTitle);
    });

    return customGroups;
}

function getMostCommonColorForTitles(titles) {
    const colorCounts = {};

    titles.forEach((title) => {
        if (!words[title]) return;
        words[title].forEach(([_, __, color]) => {
            colorCounts[color] = (colorCounts[color] || 0) + 1;
        });
    });

    const colorEntries = Object.entries(colorCounts);
    if (!colorEntries.length) return adjustHexLightness(colors.default, hexLightness);

    const mostCommon = colorEntries.reduce((best, candidate) => (candidate[1] > best[1] ? candidate : best))[0];
    return adjustHexLightness(mostCommon, hexLightness);
}

function getSeriesColor(name, index = 0) {
    if (words[name]) return getMostCommonColor(name);
    return adjustHexLightness(analyticsPalette[index % analyticsPalette.length], 58);
}

function isHiddenActivityTitle(title) {
    const normalized = String(title || "")
        .trim()
        .toLowerCase();
    return !normalized || normalized === "?" || normalized === "untitled";
}

function getAnalyticsScopeOptions(searchTerm = "") {
    const term = searchTerm.toLowerCase();
    const options = [
        {
            label: "All activities",
            value: "all",
            kind: "all",
            color: "#64748b",
            titles: []
        }
    ];

    Object.keys(words)
        .filter((key) => !isHiddenActivityTitle(key) && key.toLowerCase().includes(term) && words[key]?.[0]?.[2] !== colors.default)
        .sort((a, b) => a.localeCompare(b))
        .forEach((key) => {
            options.push({
                label: key,
                value: key,
                kind: "activity",
                color: getMostCommonColor(key),
                titles: [key]
            });
        });

    getCustomGroups().forEach((group, normalizedGroup) => {
        if (isHiddenActivityTitle(group.label)) return;
        if (!group.label.toLowerCase().includes(term)) return;

        options.push({
            label: group.label,
            value: normalizedGroup,
            kind: "group",
            color: getMostCommonColorForTitles(Array.from(group.titles)),
            titles: Array.from(group.titles)
        });
    });

    return options;
}

function getSelectedScopeLabel() {
    return analyticsScopeSelection.kind === "all" ? "All activities" : analyticsScopeSelection.label;
}

function setAnalyticsScopeSelection(selection, updateChartNow = true) {
    analyticsScopeSelection = selection;

    const selectedLabel = document.getElementById("analyticsScopeSelected");
    const selectedDot = document.getElementById("analyticsScopeDot");

    if (selectedLabel) selectedLabel.textContent = selection.label;
    if (selectedDot) {
        selectedDot.style.backgroundColor = selection.kind === "group" ? "transparent" : selection.color;
        selectedDot.style.borderColor = selection.color;
        selectedDot.classList.toggle("hidden", selection.kind === "all");
    }

    if (updateChartNow) updateChart();
}

function getSelectedScopeTitles(selection = analyticsScopeSelection) {
    if (selection.kind === "activity") return [selection.value];
    if (selection.kind === "group") return selection.titles || [];
    return [];
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttributeValue(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function processEventData(events) {
    const eventGroups = {};

    events.forEach((event) => {
        const duration = getEventDurationHours(event);
        if (!eventGroups[event.color]) eventGroups[event.color] = {};
        if (!eventGroups[event.color][event.summary]) eventGroups[event.color][event.summary] = 0;
        eventGroups[event.color][event.summary] += duration;
    });

    return eventGroups;
}

function filterEvents(start, end, title, excludeComposed = false) {
    if (start || end || title) calendarDiv.classList.add("filtered");
    else calendarDiv.classList.remove("filtered");

    const customCategories = getCustomGroups();

    function validateEvent(event) {
        if (start && new Date(event.start.dateTime).getTime() < new Date(start).getTime()) return false;
        if (end && new Date(event.end.dateTime).getTime() > new Date(end).getTime()) return false;

        if (title) {
            const eventTitle = event.summary.trim().toLowerCase();
            const compareTitle = title.trim().toLowerCase();

            if (isFilter) {
                const group = customCategories.get(compareTitle);
                if (!group) return false;

                for (const sourceTitle of group.titles) {
                    const normalizedSource = sourceTitle.toLowerCase();
                    if (excludeComposed) {
                        if (eventTitle === normalizedSource) return true;
                    } else if (splitEventSummary(eventTitle).some((part) => part === normalizedSource)) {
                        return true;
                    }
                }

                return false;
            }

            return excludeComposed ? eventTitle === compareTitle : splitEventSummary(eventTitle).some((part) => part === compareTitle);
        }

        return true;
    }

    function validateEventWrapper(event) {
        const matches = validateEvent(event);
        if (event.div) {
            if (matches) event.div.classList.add("selected");
            else event.div.classList.remove("selected");
        }
        return matches;
    }

    return originalEvents.filter((event) => validateEventWrapper(event));
}

function filterEventsByScope(events, selection) {
    if (selection.kind === "all") return events;

    const selectedTitles = getSelectedScopeTitles(selection).map((title) => title.toLowerCase());
    if (!selectedTitles.length) return [];

    return events.filter((event) => {
        const parts = splitEventSummary(event.summary).map((part) => part.toLowerCase());
        return parts.some((part) => selectedTitles.includes(part));
    });
}

function createOverviewChart(events) {
    const eventGroups = processEventData(events);
    const categories = Object.keys(eventGroups).sort((a, b) => {
        const aTotal = Object.values(eventGroups[a]).reduce((sum, value) => sum + value, 0);
        const bTotal = Object.values(eventGroups[b]).reduce((sum, value) => sum + value, 0);
        return bTotal - aTotal;
    });

    const categoryNames = {
        "#b0c4de": "Neutral",
        "#aee4c4": "Somewhat Productive",
        "#d0b1da": "Social",
        "#f7c2a4": "Somewhat Unproductive",
        "#f9dd9b": "Mix",
        "#b0b0b0": "Rest",
        "#98a8cf": "Social/Productive",
        "#9fbeaa": "Productive",
        "#e5a4a5": "Unproductive",
        "#e0e0e0": "Not Specified"
    };

    const labels = categories.map((category) => categoryNames[category] || category);
    const seriesData = [];

    categories.forEach((category, index) => {
        const sortedTitles = Object.keys(eventGroups[category]).sort((a, b) => eventGroups[category][b] - eventGroups[category][a]);
        sortedTitles.forEach((title) => {
            const data = Array(categories.length).fill(0);
            data[index] = Math.round(eventGroups[category][title] * 100) / 100;
            seriesData.push({
                name: title,
                data: data,
                color: adjustHexLightness(category, hexLightness)
            });
        });
    });

    const limits = categories.map((category) => Object.keys(eventGroups[category]).length);
    const palette = categories.map((category) => adjustHexLightness(category, hexLightness));

    function getSeriesColor(seriesIndex) {
        let index = seriesIndex;
        for (let i = 0; i < limits.length; i++) {
            if (index < limits[i]) return palette[i];
            index -= limits[i];
        }

        return palette[palette.length - 1] || analyticsPalette[0];
    }

    const overviewConfig = {
        type: "bar",
        data: {
            labels: labels.length ? labels : ["No data"],
            datasets: seriesData.length
                ? seriesData.map((series, index) => ({
                      label: series.name,
                      data: series.data,
                      backgroundColor: getSeriesColor(index),
                      hoverBackgroundColor: getSeriesColor(index),
                      borderWidth: 0,
                      borderRadius: 10,
                      borderSkipped: false
                  }))
                : [
                      {
                          label: "No data",
                          data: [0],
                          backgroundColor: "rgba(148, 163, 184, 0.22)",
                          borderWidth: 0,
                          borderRadius: 10,
                          borderSkipped: false
                      }
                  ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 420,
                easing: "easeOutQuart"
            },
            layout: {
                padding: 12
            },
            scales: {
                x: {
                    stacked: true,
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxRotation: 0,
                        minRotation: 0,
                        color: "#475569"
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: {
                        color: "rgba(148, 163, 184, 0.12)"
                    },
                    ticks: {
                        color: "#475569",
                        callback: (value) => formatDurationHours(Number(value))
                    },
                    title: {
                        display: true,
                        text: "Hours spent",
                        color: "#475569",
                        font: {
                            weight: "700"
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (tooltipItem) => `Category: ${tooltipItem[0].label}`,
                        label: (tooltipItem) => `${tooltipItem.dataset.label}: ${formatDurationTooltip(Number(tooltipItem.raw))}`,
                        footer: (tooltipItems) => {
                            const total = tooltipItems.reduce((sum, item) => sum + Number(item.raw || 0), 0);
                            return `Category total: ${formatDurationTooltip(total)}`;
                        }
                    }
                },
                legend: {
                    display: false
                }
            }
        }
    };

    if (overviewChart) {
        overviewChart.data = overviewConfig.data;
        overviewChart.options = overviewConfig.options;
        overviewChart.update();
    } else {
        overviewChart = new Chart(overviewCtx, overviewConfig);
    }
}

function collectScopeAnalytics(events, selection = analyticsScopeSelection) {
    const monthKeys = getMonthKeys(events);
    const labels = monthKeys.map(getMonthLabelFromKey);
    const monthIndex = new Map(monthKeys.map((key, index) => [key, index]));
    const allMonthlyTotals = Array(monthKeys.length).fill(0);
    const selectedMonthlyTotals = Array(monthKeys.length).fill(0);
    const seriesTotalsByTitle = new Map();
    const titleTotals = new Map();
    const selectedTitles = getSelectedScopeTitles(selection);
    const selectedTitleSet = new Set(selectedTitles.map((title) => title.toLowerCase()));

    let totalHours = 0;
    let sharedHours = 0;
    let blockCount = 0;

    events.forEach((event) => {
        const monthKey = getMonthKeyFromDate(new Date(event.start.dateTime));
        const index = monthIndex.get(monthKey);
        if (index === undefined) return;

        const duration = getEventDurationHours(event);
        allMonthlyTotals[index] += duration;

        if (selection.kind === "all") return;

        const activities = splitEventSummary(event.summary);
        const matchedActivities = activities.filter((activity) => selectedTitleSet.has(activity.toLowerCase()));
        if (!matchedActivities.length) return;

        blockCount += 1;
        totalHours += duration;
        if (activities.length > 1) sharedHours += duration;
        selectedMonthlyTotals[index] += duration;

        matchedActivities.forEach((activity) => {
            if (!seriesTotalsByTitle.has(activity)) seriesTotalsByTitle.set(activity, Array(monthKeys.length).fill(0));
            seriesTotalsByTitle.get(activity)[index] += duration;
            titleTotals.set(activity, (titleTotals.get(activity) || 0) + duration);
        });
    });

    const relevantMonthTotals = selection.kind === "all" ? allMonthlyTotals : selectedMonthlyTotals;
    const peakIndex = relevantMonthTotals.length ? relevantMonthTotals.reduce((bestIndex, value, index) => (value > relevantMonthTotals[bestIndex] ? index : bestIndex), 0) : 0;
    const peakHours = relevantMonthTotals[peakIndex] || 0;
    const peakMonthLabel = monthKeys.length ? getMonthLabelFromKey(monthKeys[peakIndex]) : "—";
    const hasData = selection.kind === "all" ? events.length > 0 : blockCount > 0;
    const message = selection.kind === "all" ? (events.length ? "Select an activity or group to see the monthly graph." : "No events match the current filters.") : blockCount ? "" : `No events found for ${selection.label} in the current filters.`;

    const series = [];
    if (selection.kind !== "all" && blockCount > 0) {
        const sortedTitles = Array.from(titleTotals.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([title]) => title);
        const titlesToShow = sortedTitles.slice(0, 8);

        titlesToShow.forEach((title) => {
            series.push({
                label: title,
                data: seriesTotalsByTitle.get(title) || Array(monthKeys.length).fill(0),
                color: getSeriesColor(title, series.length)
            });
        });

        if (sortedTitles.length > titlesToShow.length) {
            const otherData = Array(monthKeys.length).fill(0);
            sortedTitles.slice(8).forEach((title) => {
                const titleData = seriesTotalsByTitle.get(title) || [];
                titleData.forEach((value, index) => {
                    otherData[index] += value || 0;
                });
            });

            if (otherData.some((value) => value > 0)) {
                series.push({
                    label: "Other",
                    data: otherData,
                    color: "#94a3b8"
                });
            }
        }
    }

    return {
        selection,
        labels,
        monthKeys,
        allMonthlyTotals,
        selectedMonthlyTotals,
        totalHours: selection.kind === "all" ? allMonthlyTotals.reduce((sum, value) => sum + value, 0) : totalHours,
        sharedHours,
        blockCount: selection.kind === "all" ? events.length : blockCount,
        peakMonthLabel,
        peakHours,
        series,
        hasData,
        message
    };
}

function createTimelineChart(events) {
    const scopeData = collectScopeAnalytics(events);
    const canvas = document.getElementById("timelineChart");
    const emptyState = document.getElementById("timelineEmptyState");

    if (scopeData.selection.kind === "all" || !scopeData.series.length) {
        if (timelineChart) {
            timelineChart.destroy();
            timelineChart = null;
        }

        canvas.classList.add("hidden");
        emptyState.classList.remove("hidden");
        emptyState.textContent = scopeData.message;
        return scopeData;
    }

    emptyState.classList.add("hidden");
    canvas.classList.remove("hidden");

    const timelineConfig = {
        type: "line",
        data: {
            labels: scopeData.labels.length ? scopeData.labels : ["No data"],
            datasets: scopeData.series.length
                ? scopeData.series.map((series) => ({
                      label: series.label,
                      data: series.data,
                      backgroundColor: "rgba(15, 23, 42, 0)",
                      hoverBackgroundColor: "rgba(15, 23, 42, 0)",
                      borderColor: series.color,
                      pointBackgroundColor: series.color,
                      pointBorderColor: series.color,
                      pointRadius: 4,
                      pointHoverRadius: 5,
                      borderWidth: 2,
                      fill: false,
                      tension: 0.32
                  }))
                : [
                      {
                          label: "No data",
                          data: [0],
                          backgroundColor: "rgba(148, 163, 184, 0)",
                          borderColor: "rgba(148, 163, 184, 0.22)",
                          pointRadius: 0,
                          borderWidth: 2,
                          fill: false
                      }
                  ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 420,
                easing: "easeOutQuart"
            },
            layout: {
                padding: 12
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: "#475569",
                        maxRotation: 0,
                        minRotation: 0
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: "rgba(148, 163, 184, 0.12)"
                    },
                    ticks: {
                        color: "#475569",
                        callback: (value) => formatDurationHours(Number(value))
                    },
                    title: {
                        display: true,
                        text: "Hours spent",
                        color: "#475569",
                        font: {
                            weight: "700"
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (tooltipItem) => tooltipItem[0].label,
                        label: (tooltipItem) => `${tooltipItem.dataset.label}: ${formatDurationHours(Number(tooltipItem.raw))}`,
                        afterLabel: (tooltipItem) => {
                            if (scopeData.selection.kind === "activity") {
                                const monthIndex = scopeData.labels.indexOf(tooltipItem.label);
                                const shared = scopeData.selectedMonthlyTotals[monthIndex] || 0;
                                return `Scope total: ${formatDurationHours(shared)}`;
                            }

                            return "";
                        },
                        footer: (tooltipItems) => {
                            const total = tooltipItems.reduce((sum, item) => sum + Number(item.raw || 0), 0);
                            return `Month total: ${formatDurationTooltip(total)}`;
                        }
                    }
                },
                legend: {
                    display: scopeData.series.length > 1,
                    position: "bottom",
                    labels: {
                        usePointStyle: true,
                        boxWidth: 10,
                        boxHeight: 10,
                        color: "#334155"
                    }
                }
            }
        }
    };

    if (timelineChart) {
        timelineChart.data = timelineConfig.data;
        timelineChart.options = timelineConfig.options;
        timelineChart.update();
    } else {
        timelineChart = new Chart(timelineCtx, timelineConfig);
    }

    return scopeData;
}

function updateAnalyticsMetrics(events, scopeData) {
    const totalHours = scopeData.totalHours;
    const selectedHours = scopeData.selection.kind === "all" ? totalHours : scopeData.totalHours;
    const label = scopeData.selection.kind === "all" ? "Visible blocks" : "Matching blocks";
    const subtitle = scopeData.selection.kind === "all" ? "Select an activity or group to drill down" : scopeData.sharedHours > 0 ? `${formatDurationHours(scopeData.sharedHours)} in combined blocks` : "Only solo blocks";

    document.getElementById("metricTotalHours").textContent = formatDurationHours(selectedHours);
    document.getElementById("metricTotalLabel").textContent = subtitle;
    document.getElementById("metricActivityCount").textContent = scopeData.blockCount.toString();
    document.getElementById("metricActivityLabel").textContent = label;
    document.getElementById("metricPeakMonth").textContent = scopeData.peakMonthLabel;
    document.getElementById("metricPeakLabel").textContent = scopeData.selection.kind === "all" ? `${formatDurationHours(scopeData.peakHours)} in the busiest month` : `${formatDurationHours(scopeData.peakHours)} in that month`;
}

function updateChart() {
    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;
    const titleText = document.getElementById("selectedTitle").textContent;
    const excludeComposed = document.getElementById("excludeComposed").checked;

    const title = titleText === "Select title..." ? "" : titleText;
    const filteredEvents = filterEvents(startDate, endDate, title, excludeComposed);
    const scopedEvents = filterEventsByScope(filteredEvents, analyticsScopeSelection);

    createOverviewChart(scopedEvents);
    const scopeData = createTimelineChart(filteredEvents);
    updateAnalyticsMetrics(filteredEvents, scopeData);
}

document.getElementById("startDate").addEventListener("change", updateChart);
document.getElementById("endDate").addEventListener("change", updateChart);
document.getElementById("excludeComposed").addEventListener("change", updateChart);

function initializeTitleDropdown() {
    const dropdownButton = document.getElementById("titleDropdown");
    const menu = document.getElementById("titleMenu");
    const searchInput = document.getElementById("titleSearch");
    const optionsContainer = document.getElementById("titleOptions");
    const selectedTitle = document.getElementById("selectedTitle");
    const selectedDot = document.getElementById("selectedDot");

    function updateDropdown() {
        updateOptions(searchInput.value);
    }

    function clearSelection() {
        selectedTitle.textContent = "Select title...";
        searchInput.value = "";
        selectedDot.classList.add("hidden");
        menu.classList.add("hidden");
        isFilter = false;
        updateChart();
        updateDropdown();
    }

    function updateOptions(searchTerm = "") {
        optionsContainer.innerHTML = "";

        const clearOption = document.createElement("div");
        clearOption.className = "dropdown-option";
        clearOption.textContent = "Clear selection";
        clearOption.addEventListener("click", clearSelection);
        optionsContainer.appendChild(clearOption);

        const customCategories = new Map();

        document.querySelectorAll(".modification").forEach((mod) => {
            const sourceTitle = mod.querySelector(".mod-filter-label")?.textContent || "";
            const replaceValue = mod.querySelector(".mod-replace-input")?.value;
            if (sourceTitle && sourceTitle !== "Select a filter..." && replaceValue) {
                if (!customCategories.has(replaceValue)) customCategories.set(replaceValue, new Set());
                customCategories.get(replaceValue).add(sourceTitle);
            }
        });

        Object.keys(words)
            .filter((key) => !isHiddenActivityTitle(key) && key.toLowerCase().includes(searchTerm.toLowerCase()) && words[key][0][2] !== colors.default)
            .forEach((key) => addOptionToDropdown(key, getMostCommonColor(key), false));

        customCategories.forEach((sources, category) => {
            if (isHiddenActivityTitle(category)) return;
            if (!category.toLowerCase().includes(searchTerm.toLowerCase())) return;

            const colorCounts = {};
            Array.from(sources).forEach((realCategory) => {
                const [color, n] = getMostCommonColor(realCategory, true);
                colorCounts[color] = (colorCounts[color] || 0) + n;
            });

            const mostCommon = Object.keys(colorCounts).reduce((a, b) => (colorCounts[a] > colorCounts[b] ? a : b));
            addOptionToDropdown(category, mostCommon, true);
        });

        function addOptionToDropdown(text, color, filter) {
            if (optionsContainer.querySelector(`[data-value="${escapeAttributeValue(text)}"]`)) return;

            const option = document.createElement("div");
            option.className = "dropdown-option";
            option.dataset.value = text;

            const dot = document.createElement("span");
            dot.className = "select-dot";
            dot.style.backgroundColor = filter ? "transparent" : color;
            dot.style.borderColor = color;
            option.appendChild(dot);

            const textSpan = document.createElement("span");
            textSpan.textContent = text;
            option.appendChild(textSpan);

            option.addEventListener("click", () => {
                selectedTitle.textContent = text;
                selectedDot.style.backgroundColor = filter ? "transparent" : color;
                selectedDot.style.borderColor = color;
                selectedDot.classList.remove("hidden");
                menu.classList.add("hidden");
                isFilter = filter;
                updateChart();
            });

            optionsContainer.appendChild(option);
        }
    }

    dropdownButton.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.classList.toggle("hidden");
        if (!menu.classList.contains("hidden")) searchInput.focus();
    });

    searchInput.addEventListener("input", (e) => {
        updateOptions(e.target.value);
    });

    document.addEventListener("click", () => {
        menu.classList.add("hidden");
    });

    menu.addEventListener("click", (e) => {
        e.stopPropagation();
    });

    document.addEventListener("updatedropdown", updateDropdown);

    document.addEventListener("validatetitle", () => {
        const currentTitle = selectedTitle.textContent;
        const value = currentTitle === "Select title..." ? "" : currentTitle;
        if (isFilter && !Array.from(document.querySelectorAll(".mod-replace-input")).some((input) => input.value.trim() === value.trim())) clearSelection();
        else updateDropdown();
    });

    updateOptions();
}

function initializeAnalyticsScopeDropdown() {
    const dropdownButton = document.getElementById("analyticsScopeDropdown");
    const menu = document.getElementById("analyticsScopeMenu");
    const searchInput = document.getElementById("analyticsScopeSearch");
    const optionsContainer = document.getElementById("analyticsScopeOptions");
    const selectedLabel = document.getElementById("analyticsScopeSelected");
    const selectedDot = document.getElementById("analyticsScopeDot");

    function updateOptions(searchTerm = "") {
        const options = getAnalyticsScopeOptions(searchTerm);
        optionsContainer.innerHTML = "";

        options.forEach((option) => {
            const optionButton = document.createElement("div");
            optionButton.className = "dropdown-option";
            optionButton.dataset.value = `${option.kind}:${option.value}`;

            const dot = document.createElement("span");
            dot.className = "select-dot";
            dot.style.backgroundColor = option.kind === "group" ? "transparent" : option.color;
            dot.style.borderColor = option.color;
            optionButton.appendChild(dot);

            const textSpan = document.createElement("span");
            textSpan.textContent = option.label;
            optionButton.appendChild(textSpan);

            optionButton.addEventListener("click", () => {
                setAnalyticsScopeSelection(option, false);
                menu.classList.add("hidden");
                updateChart();
            });

            optionsContainer.appendChild(optionButton);
        });
    }

    dropdownButton.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.classList.toggle("hidden");
        if (!menu.classList.contains("hidden")) searchInput.focus();
    });

    searchInput.addEventListener("input", (e) => {
        updateOptions(e.target.value);
    });

    document.addEventListener("click", () => {
        menu.classList.add("hidden");
    });

    menu.addEventListener("click", (e) => {
        e.stopPropagation();
    });

    document.addEventListener("validatetitle", () => {
        updateOptions(searchInput.value);
    });

    updateOptions();
}

fetchData().then(() => {
    if (!originalEvents.length) return;

    renderCalendar(originalEvents);
    setCalendarLoadingState(false);
    scrollCalendarToEnd();
    initializeTitleDropdown();
    initializeAnalyticsScopeDropdown();
    updateChart();
});
