export function placeDialControl(document, window, home) {
  const start = document.getElementById("start");
  const compact = window.matchMedia("(max-width:700px)").matches &&
    document.body.dataset.callState === "idle" &&
    document.body.dataset.conversation === "started";
  const parent = compact ? document.getElementById("callPill") : home;
  if (start.parentElement !== parent) parent.append(start);
  const label = compact ? "重新拨号" : "拨号";
  start.setAttribute("aria-label", label);
  start.title = label;
}

export function mountProductControls(document, window, { onMute }) {
  const $ = (id) => document.getElementById(id),
    form = $("steerForm"),
    toggle = $("textToggle"),
    model = $("voiceModel"),
    menu = $("modelMenu"),
    trigger = $("modelTrigger");
  const dialHome = $("start").parentElement;
  const placeDial = () => placeDialControl(document, window, dialHome);
  let muted = false;
  function compose(open) {
    form.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "收起文字输入" : "打开文字输入");
    if (open) $("steerText").focus({ preventScroll: true });
    else {
      $("steerText").blur();
      if (!toggle.hidden) toggle.focus({ preventScroll: true });
    }
  }
  function modelMenu(open) {
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  }
  function modelChoices() {
    $("modelName").textContent =
      model.selectedOptions[0]?.textContent ?? "GPT Live";
    trigger.disabled = model.disabled;
    menu.replaceChildren();
    for (const option of model.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option.textContent;
      button.disabled = option.disabled;
      button.setAttribute("role", "menuitemradio");
      button.setAttribute("aria-checked", String(option.selected));
      button.addEventListener("click", () => {
        model.value = option.value;
        model.dispatchEvent(new window.Event("change", { bubbles: true }));
        modelChoices();
        modelMenu(false);
        trigger.focus();
      });
      menu.append(button);
    }
  }
  const viewport = () =>
    document.documentElement.style.setProperty(
      "--voice-height",
      (window.visualViewport?.height ?? window.innerHeight) + "px",
    );
  window.visualViewport?.addEventListener("resize", viewport);
  window.addEventListener("resize", viewport);
  window.addEventListener("resize", placeDial);
  viewport();
  // The compact H5 avatar row has room for the avatar, not a second large
  // control row. Reuse the original button and its listener in the call pill.
  const layoutObserver = new window.MutationObserver(placeDial);
  layoutObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-conversation"],
  });
  placeDial();
  toggle.addEventListener("click", () => compose(form.dataset.open !== "true"));
  $("composerClose").addEventListener("click", () => compose(false));
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && form.dataset.open === "true") {
      event.stopPropagation();
      event.preventDefault();
      compose(false);
    }
  });
  trigger.addEventListener("click", () => modelMenu(menu.hidden));
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      modelMenu(false);
      trigger.focus();
    }
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const options = [...menu.querySelectorAll("button:not(:disabled)")],
        index = options.indexOf(document.activeElement);
      options[
        (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
          options.length
      ]?.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".model-picker")) modelMenu(false);
  });
  model.addEventListener("change", modelChoices);
  const avatarObserver = new window.MutationObserver(() => {
    $("pillPortrait").src = $("avatar").src;
  });
  avatarObserver.observe($("avatar"), {
    attributes: true,
    attributeFilter: ["src"],
  });
  const observer = new window.MutationObserver(modelChoices);
  observer.observe(model, {
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "selected"],
  });
  modelChoices();
  const stopLabel = () => {
    const label = $("stopLabel").textContent;
    $("stop").setAttribute("aria-label", label);
    $("stop").title = label;
  };
  const labelObserver = new window.MutationObserver(stopLabel);
  labelObserver.observe($("stopLabel"), {
    childList: true,
    characterData: true,
    subtree: true,
  });
  stopLabel();
  $("mute").addEventListener("click", () => {
    const next = !muted;
    if (!onMute(next)) return;
    muted = next;
    $("mute").setAttribute("aria-pressed", String(muted));
    $("mute").setAttribute("aria-label", muted ? "打开麦克风" : "静音麦克风");
    $("mute").title = muted ? "打开麦克风" : "静音麦克风";
    document.body.dataset.microphoneMuted = String(muted);
    $("mutedNotice").hidden = !muted;
  });
  window.addEventListener(
    "pagehide",
    () => {
      observer.disconnect();
      avatarObserver.disconnect();
      labelObserver.disconnect();
      layoutObserver.disconnect();
      window.removeEventListener("resize", placeDial);
    },
    { once: true },
  );
  return {
    refreshModels: modelChoices,
    callState(state) {
      placeDial();
      const active = ["connected", "ending"].includes(state);
      toggle.hidden = !active;
      $("mute").hidden = !active;
      if (!active) {
        compose(false);
        muted = false;
        $("mute").setAttribute("aria-pressed", "false");
        $("mute").setAttribute("aria-label", "静音麦克风");
        $("mute").title = "静音麦克风";
        document.body.dataset.microphoneMuted = "false";
        $("mutedNotice").hidden = true;
      }
      if (state === "idle") modelMenu(false);
    },
    sent() {
      if (window.matchMedia("(max-width:700px)").matches) compose(false);
    },
  };
}
