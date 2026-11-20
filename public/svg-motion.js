"use strict";

(function (global) {
  const { beatPhases, keywords } = StageSvgContent;
  const content = Contents.svg.html;
  const clamp = value => Math.max(0, Math.min(1, value));

  function templateDeck(layout, shots) {
    return TemplateVideo.normalizeDeck({
      ...layout,
      chapters: ["先看要点", "用药提醒"],
      slides: shots.map(({beats, ...shot}, index) => ({
        ...shot,
        svgBeats: beats,
        chapterIndex: shots.length > 1 && index === shots.length - 1 ? 1 : 0,
        type: "explain",
        layoutMode: "explain",
        highlightWords: [...new Set([
          ...(beats || [shot]).flatMap(beat => [beat.label, ...keywords[beat.action]]),
          shot.name,
        ])].filter(word => word && shot.line.includes(word)).slice(0, 4),
      })),
    });
  }

  function subtitleAt(shot, progress, intervals) {
    if (intervals?.length) {
      return TemplateVideo.stripTrailingSubtitlePunctuation(
        (intervals.find(cue => progress < cue.end) || intervals.at(-1)).text
      );
    }
    if (shot.svgBeats?.length) {
      const phases = beatPhases(shot.svgBeats, progress);
      const active = phases.findIndex(value => value < 1 && value >= 0);
      const index = active < 0 ? phases.length - 1 : active;
      return subtitleAt({ line: shot.svgBeats[index].line }, clamp(phases[index]));
    }
    const cues = TemplateVideo.getSlideCues(shot, 23);
    const total = cues.reduce((sum, cue) => sum + cue.weight, 0);
    let end = 0;
    return TemplateVideo.stripTrailingSubtitlePunctuation(
      (cues.find(cue => (end += cue.weight) > progress * total) || cues.at(-1))?.text || ""
    );
  }

  function frameOptions(deck, index, progress, options) {
    const shot = deck.slides[index];
    const total = deck.slides.reduce((sum, slide) => sum + slide.seconds, 0);
    const elapsed = deck.slides.slice(0, index).reduce((sum, slide) => sum + slide.seconds, 0);
    return {
      renderMedia: () => content(shot, progress, deck.theme),
      subtitleText: subtitleAt(shot, progress, options.subtitles),
      progress: (elapsed + shot.seconds * clamp(progress)) / total,
      imgMap: options.imgMap,
    };
  }

  function frame(deck, index, progress = 0, options = {}) {
    return TemplateVideo.renderFrameHtml(deck, index, frameOptions(deck, index, progress, options));
  }

  global.SvgMotion = { frame, frameOptions, templateDeck, content };
})(globalThis);
