let originalEvents = [];
const calendarDiv = document.getElementById("calendar");
const ctx = document.getElementById("chart").getContext("2d");
const words = {};
const hexLightness = 50;
let chart;
let isFilter = false;
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
        }
    });

    const currentDayStart = new Date(firstDayEnd);
    currentDayStart.setHours(0, 0, 0, 0);
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
            }
        });

        currentDayStart.setDate(currentDayStart.getDate() + 1);
    }

    if (new Date(splitEvents[splitEvents.length - 1].start.dateTime).getDate() === 1)
        splitEvents.pop();

    return splitEvents;
}

async function fetchData() {
    try {
        const response = await fetch("https://workers.tablerus.es/calendar/everything");
        if (!response.ok) throw new Error("Network response error");

        originalEvents = (await response.json()).flatMap(processEvent);
    } catch (error) {
        console.error("Fetch error:", error);
    }
}

function renderDay(dateD) {
    const dayEvents = originalEvents.filter((event) => {
        const eventDate = new Date(event.start.dateTime);
        return (
            eventDate.getFullYear() === dateD.getFullYear() &&
            eventDate.getMonth() === dateD.getMonth() &&
            eventDate.getDate() === dateD.getDate()
        );
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
        const startTime = new Date(
            event.trueStart ? event.trueStart.dateTime : event.start.dateTime
        ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
        const endTime = new Date(
            event.trueEnd ? event.trueEnd.dateTime : event.end.dateTime
        ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
        const duration =
            (new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime()) /
            60000;

        const outerDiv = document.createElement("div");
        outerDiv.classList.add("eventOuter");
        outerDiv.style.flex = duration;
        div.appendChild(outerDiv);

        const innerDiv = document.createElement("div");
        innerDiv.classList.add("eventInner");
        innerDiv.style.backgroundColor = event.color;
        outerDiv.appendChild(innerDiv);

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

        if (
            event.summary.indexOf("+") === -1 &&
            event.summary.trim() !== "?" &&
            event.color !== colors.default
        ) {
            innerDiv.style.cursor = "pointer";
            innerDiv.addEventListener("click", () => {
                if (
                    document.getElementById("selectedTitle").textContent.trim().toLowerCase() ===
                    event.summary.trim().toLowerCase()
                )
                    document.getElementById("titleOptions").childNodes[0].click();
                else
                    document
                        .getElementById("titleOptions")
                        .querySelector(`[data-value=${event.summary}]`)
                        .click();
            });
        } else innerDiv.style.cursor = "not-allowed";
    });

    return div;
}

function renderMonth(dateM) {
    const div = document.createElement("div");
    div.classList.add("relative");

    const h2 = document.createElement("h2");
    h2.classList.add("stickyMonthTitle");
    h2.innerHTML = `<strong>${new Date(dateM.getFullYear(), dateM.getMonth(), 1).toLocaleString(
        "default",
        {
            month: "long"
        }
    )}</strong> ${dateM.getFullYear()}`;
    div.appendChild(h2);

    const startDate = new Date(dateM);
    const endDate = new Date(dateM);
    endDate.setMonth(endDate.getMonth() + 1);
    h2.addEventListener("click", () => {
        const inputStartDate = document.getElementById("startDate").value;
        const inputEndDate = document.getElementById("endDate").value;
        const formattedStart = `${startDate.getFullYear()}-${String(
            startDate.getMonth() + 1
        ).padStart(2, "0")}-01T00:00`;
        const formattedEnd = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(
            2,
            "0"
        )}-01T00:00`;
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
    const firstEventDate = new Date(events[0].start.dateTime);
    const lastEventDate = new Date(events[events.length - 1].start.dateTime);

    const currentDate = new Date(firstEventDate.getFullYear(), firstEventDate.getMonth(), 1);

    while (currentDate <= lastEventDate) {
        calendarDiv.appendChild(renderMonth(currentDate));
        currentDate.setMonth(currentDate.getMonth() + 1);
    }

    calendarDiv.scroll(1000000000, 0);
}

document.getElementById("addModificationBtn").addEventListener("click", addModification);
function addModification(filter, replace) {
    const modificationDiv = document.createElement("div");
    modificationDiv.className = "modification flex gap-2 items-center";

    // Create custom dropdown container
    const dropdownContainer = document.createElement("div");
    dropdownContainer.className = "relative";

    // Create dropdown button that shows selected value
    const dropdownButton = document.createElement("button");
    dropdownButton.className = "border p-2 rounded w-64 text-left flex items-center gap-2";

    const selectedDot = document.createElement("div");
    selectedDot.className = "w-3 h-3 rounded-full hidden";
    dropdownButton.appendChild(selectedDot);

    const buttonText = document.createElement("span");
    buttonText.textContent = "Select a filter...";
    dropdownButton.appendChild(buttonText);

    // Create dropdown menu
    const dropdownMenu = document.createElement("div");
    dropdownMenu.className =
        "absolute mt-1 w-64 bg-white border rounded shadow-lg hidden max-h-64 overflow-y-auto z-50";

    // Create search input
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "border-b w-full p-2 sticky top-0 bg-white";
    searchInput.placeholder = "Search...";
    dropdownMenu.appendChild(searchInput);

    // Create options container
    const optionsContainer = document.createElement("div");
    optionsContainer.className = "py-1";
    dropdownMenu.appendChild(optionsContainer);

    let lastModification = "";
    let lastReplaceValue = "";

    const updateOptions = (searchTerm = "") => {
        optionsContainer.innerHTML = "";
        Object.keys(words)
            .filter(
                (key) =>
                    key.toLowerCase().includes(searchTerm.toLowerCase()) &&
                    words[key][0][2] !== colors.default &&
                    key !== "?"
            )
            .forEach((key) => {
                const option = document.createElement("div");
                option.className =
                    "flex items-center gap-2 px-3 py-2 hover:bg-gray-100 cursor-pointer";

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
                    if (lastModification === title || key === title || lastReplaceValue === title)
                        updateChart();
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
    replaceInput.className = "border p-2 rounded";
    replaceInput.placeholder = "Replace with...";
    replaceInput.value = replace || "";

    // Create remove button
    const removeButton = document.createElement("button");
    removeButton.className = "px-3 py-2 bg-red-500 text-white rounded";
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

    const regex = new RegExp(filter, "g");
    words[filter].forEach(([originalText, element, color]) => {
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
    if (overrides[key.toLowerCase()])
        return adjustHexLightness(overrides[key.toLowerCase()], hexLightness);
    const colorCounts = {};
    words[key].forEach(([_, __, color]) => {
        colorCounts[color] = (colorCounts[color] || 0) + 1;
    });

    const mostCommon = Object.keys(colorCounts).reduce((a, b) =>
        colorCounts[a] > colorCounts[b] ? a : b
    );
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

// Should be done from the server
function processEventData(events) {
    let eventGroups = {};

    events.forEach((event) => {
        const start = new Date(event.start.dateTime || event.start.date);
        const end = new Date(event.end.dateTime || event.end.date);
        const duration = (end - start) / (1000 * 60 * 60);

        if (!eventGroups[event.color]) eventGroups[event.color] = {};
        if (!eventGroups[event.color][event.summary]) eventGroups[event.color][event.summary] = 0;
        eventGroups[event.color][event.summary] += duration;
    });

    return eventGroups;
}

function filterEvents(start, end, title, excludeComposed = false) {
    if (start || end || title) calendarDiv.classList.add("filtered");
    else calendarDiv.classList.remove("filtered");

    const customCategories = new Map();
    document.querySelectorAll(".modification").forEach((mod) => {
        const sourceTitle = mod.querySelector("button span")?.textContent.trim().toLowerCase();
        const replaceValue = mod.childNodes[1].value.trim().toLowerCase();
        if (sourceTitle && sourceTitle !== "Select a filter..." && replaceValue) {
            if (!customCategories.has(replaceValue)) customCategories.set(replaceValue, new Set());
            customCategories.get(replaceValue).add(sourceTitle);
        }
    });

    function validateEvent(event) {
        if (start && new Date(event.start.dateTime).getTime() < new Date(start).getTime())
            return false;
        if (end && new Date(event.end.dateTime).getTime() > new Date(end).getTime()) return false;
        if (title) {
            const eventTitle = event.summary.trim().toLowerCase();
            const compareTitle = title.trim().toLowerCase();

            if (isFilter) {
                if (customCategories.has(compareTitle)) {
                    for (const sourceTitle of customCategories.get(compareTitle)) {
                        if (excludeComposed) {
                            if (eventTitle === sourceTitle.toLowerCase()) return true;
                        } else if (
                            eventTitle
                                .split("+")
                                .some((title) => title.trim() === sourceTitle.toLowerCase())
                        )
                            return true;
                    }
                }
                return false;
            }

            const directMatch = excludeComposed
                ? eventTitle === compareTitle
                : eventTitle.split("+").some((title) => title.trim() === compareTitle);

            return directMatch;
        }
        return true;
    }

    function validateEventWrapper(event) {
        const ret = validateEvent(event);
        if (ret) event.div.classList.add("selected");
        else event.div.classList.remove("selected");
        return ret;
    }

    return originalEvents.filter((event) => validateEventWrapper(event));
}

function createApexChart(events) {
    if (chart) chart.destroy();
    const eventGroups = processEventData(events);
    const rawCategories = Object.keys(eventGroups);

    let totalSum = 0;
    const totals = rawCategories.map((category) => {
        const total = Object.values(eventGroups[category]).reduce((a, b) => a + b, 0);
        totalSum += total;
        return {
            category: category,
            total: total
        };
    });
    totals.sort((a, b) => b.total - a.total);
    const categories = totals.map((item) => item.category);

    const categoriesTemp = {
        "#b0c4de": "Neutral",
        "#aee4c4": "Somewhat Productive",
        "#d0b1da": "Social",
        "#f7c2a4": "Somewhat Unproductive",
        "#f9dd9b": "Mix",
        "#000": "",
        "#000": "",
        "#b0b0b0": "Rest",
        "#98a8cf": "Social/Productive",
        "#9fbeaa": "Productive",
        "#e5a4a5": "Unproductive",
        "#e0e0e0": "Not Specified"
    };
    const categoriesName = [];
    const colors = [];
    console.log();
    categories.forEach((category, i) => {
        colors.push(adjustHexLightness(category, hexLightness));
        categoriesName.push(categoriesTemp[category]);
        /*
                console.log(
                    `${categoriesTemp[category]} - ${
                        Math.round((totals[i].total / totalSum) * 10000) / 100
                    }%`
                );
                */
    });
    console.log();

    const seriesData = [];

    categories.forEach((category, i) => {
        const sortedTitles = Object.keys(eventGroups[category]).sort((a, b) => {
            return eventGroups[category][a] - eventGroups[category][b];
        });

        sortedTitles.forEach((title) => {
            const data = Array(categories.length).fill(0);
            data[i] = Math.round(eventGroups[category][title] * 100) / 100;
            seriesData.push({
                name: title,
                data: data
            });
        });
    });

    const limits = Array.from(
        { length: categories.length },
        (_, i) => Object.keys(eventGroups[categories[i]]).length
    );

    function getColor(seriesIndex) {
        let index = seriesIndex;
        for (let i = 0; i < colors.length; i++) {
            if (index < limits[i]) return colors[i];
            index -= limits[i];
        }
        return colors[colors.length - 1];
    }

    const datasets = seriesData.map((series, index) => ({
        label: series.name,
        data: series.data,
        backgroundColor: getColor(index),
        hoverBackgroundColor: getColor(index),
        borderWidth: 0
    }));

    chart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: categoriesName,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        maxRotation: 0,
                        minRotation: 0,
                        autoSkip: false
                    }
                },
                y: {
                    stacked: true,
                    title: {
                        display: true,
                        text: "Hours Spent",
                        font: {
                            weight: "bold"
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (tooltipItem) => {
                            return tooltipItem[0].dataset.label;
                        },
                        label: (tooltipItem) => {
                            const val = tooltipItem.raw;
                            const hours = Math.floor(val);
                            const minutes = Math.round((val % 1) * 60);
                            return hours + " hours " + minutes + " minutes";
                        }
                    }
                },
                legend: {
                    display: false
                }
            }
        }
    });
}

document.getElementById("startDate").addEventListener("change", updateChart);
document.getElementById("endDate").addEventListener("change", updateChart);
document.getElementById("excludeComposed").addEventListener("change", updateChart);
function updateChart() {
    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;
    const titleText = document.getElementById("selectedTitle").textContent;
    const excludeComposed = document.getElementById("excludeComposed").checked;

    const title = titleText === "Select title..." ? "" : titleText;
    createApexChart(filterEvents(startDate, endDate, title, excludeComposed));
}

fetchData().then(() => {
    renderCalendar(originalEvents);
    /*
    if (words["Japanese"]) addModification("Japanese", "Languages");
    if (words["Duolingo"]) addModification("Duolingo", "Languages");
    if (words["Cycling"]) addModification("Cycling", "Sports");
    if (words["Running"]) addModification("Running", "Sports");
    if (words["Boxing"]) addModification("Boxing", "Sports");
    if (words["Workout"]) addModification("Workout", "Sports");
    if (words["Friends"]) addModification("Friends", "Social");
    if (words["Friend"]) addModification("Friend", "Social");
    if (words["Family"]) addModification("Family", "Social");
    */

    function initializeTitleDropdown() {
        const dropdownButton = document.getElementById("titleDropdown");
        const menu = document.getElementById("titleMenu");
        const searchInput = document.getElementById("titleSearch");
        const optionsContainer = document.getElementById("titleOptions");
        const selectedTitle = document.getElementById("selectedTitle");
        const selectedDot = document.getElementById("selectedDot");

        function updateDropdown() {
            const searchTerm = document.getElementById("titleSearch").value;
            updateOptions(searchTerm);
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
            optionsContainer.innerHTML =
                '<div class="px-3 py-2 hover:bg-gray-100 cursor-pointer">Clear selection</div>';

            const customCategories = new Map();

            document.querySelectorAll(".modification").forEach((mod) => {
                const sourceTitle = mod.querySelector("button span")?.textContent;
                const replaceValue = mod.childNodes[1].value;
                if (sourceTitle && sourceTitle !== "Select a filter..." && replaceValue) {
                    if (!customCategories.has(replaceValue))
                        customCategories.set(replaceValue, new Set());
                    customCategories.get(replaceValue).add(sourceTitle);
                }
            });

            Object.keys(words)
                .filter(
                    (key) =>
                        key.toLowerCase().includes(searchTerm.toLowerCase()) &&
                        words[key][0][2] !== colors.default &&
                        key !== "?"
                )
                .forEach((key) => addOptionToDropdown(key, getMostCommonColor(key), false));

            customCategories.forEach((sources, category) => {
                if (category.toLowerCase().includes(searchTerm.toLowerCase())) {
                    const colorCounts = {};
                    Array.from(customCategories.get(category)).forEach((realCategory) => {
                        const [color, n] = getMostCommonColor(realCategory, true);
                        colorCounts[color] = (colorCounts[color] || 0) + n;
                    });
                    const mostCommon = Object.keys(colorCounts).reduce((a, b) =>
                        colorCounts[a] > colorCounts[b] ? a : b
                    );
                    addOptionToDropdown(category, mostCommon, true);
                }
            });

            function addOptionToDropdown(text, color, filter) {
                if (optionsContainer.querySelector(`[data-value="${text}"]`)) return;

                const option = document.createElement("div");
                option.className =
                    "flex items-center gap-2 px-3 py-2 hover:bg-gray-100 cursor-pointer";
                option.dataset.value = text;

                const dot = document.createElement("div");
                dot.className = "w-3 h-3 rounded-full";
                dot.style.backgroundColor = filter ? "transparent" : color;
                dot.style.border = `3px ${color} solid`;
                option.appendChild(dot);

                const textSpan = document.createElement("span");
                textSpan.textContent = text;
                option.appendChild(textSpan);

                option.addEventListener("click", () => {
                    selectedTitle.textContent = text;
                    selectedDot.style.backgroundColor = filter ? "transparent" : color;
                    selectedDot.style.border = `3px ${color} solid`;
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
            if (!menu.classList.contains("hidden")) {
                searchInput.focus();
            }
        });

        searchInput.addEventListener("input", (e) => {
            updateOptions(e.target.value);
        });

        document.addEventListener("click", () => {
            menu.classList.add("hidden");
        });

        menu.addEventListener("click", (e) => {
            e.stopPropagation();
            if (e.target.textContent === "Clear selection") clearSelection();
        });

        document.addEventListener("updatedropdown", () => {
            updateDropdown();
        });

        document.addEventListener("validatetitle", () => {
            const tText = selectedTitle.textContent;
            const value = tText === "Select title..." ? "" : tText;
            if (
                isFilter &&
                !Array.from(document.querySelectorAll(".modification input")).some(
                    (input) => input.value.trim() === value.trim()
                )
            )
                clearSelection();
            else updateDropdown();
        });

        updateOptions();
    }

    createApexChart(originalEvents);
    initializeTitleDropdown();
});
