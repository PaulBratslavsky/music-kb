import type { Schema, Struct } from '@strapi/strapi';

export interface ContentActionStep extends Struct.ComponentSchema {
  collectionName: 'components_content_action_steps';
  info: {
    description: 'A concrete step the reader can take. Repeatable; the post renders these as a numbered plan at the end of the summary.';
    displayName: 'Action step';
  };
  attributes: {
    body: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 600;
      }>;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
  };
}

export interface ContentDigestContradiction extends Struct.ComponentSchema {
  collectionName: 'components_content_digest_contradictions';
  info: {
    description: 'A genuine disagreement between source videos on one concrete topic, with the positions taken by each side.';
    displayName: 'Digest Contradiction';
  };
  attributes: {
    positions: Schema.Attribute.Component<
      'content.digest-contradiction-position',
      true
    > &
      Schema.Attribute.SetMinMax<
        {
          min: 2;
        },
        number
      >;
    topic: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
  };
}

export interface ContentDigestContradictionPosition
  extends Struct.ComponentSchema {
  collectionName: 'components_content_digest_contradiction_positions';
  info: {
    description: "One video's stance on a contested topic. Nested under a contradiction component (\u22652 positions per topic).";
    displayName: 'Digest Contradiction Position';
  };
  attributes: {
    stance: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 400;
      }>;
    videoTitle: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
  };
}

export interface ContentDigestSharedTheme extends Struct.ComponentSchema {
  collectionName: 'components_content_digest_shared_themes';
  info: {
    description: 'A theme that appears across two or more source videos of a digest.';
    displayName: 'Digest Shared Theme';
  };
  attributes: {
    body: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 1500;
      }>;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    videoTitles: Schema.Attribute.Component<'content.digest-video-title', true>;
  };
}

export interface ContentDigestUniqueInsight extends Struct.ComponentSchema {
  collectionName: 'components_content_digest_unique_insights';
  info: {
    description: 'What one specific source video uniquely contributes to a digest, beyond what the others cover.';
    displayName: 'Digest Unique Insight';
  };
  attributes: {
    insight: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 600;
      }>;
    videoTitle: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
  };
}

export interface ContentDigestVideoTitle extends Struct.ComponentSchema {
  collectionName: 'components_content_digest_video_titles';
  info: {
    description: "Single verbatim video title string. Used inside shared-theme components to list which source videos cover the theme \u2014 a nested repeatable component stands in for a `string[]` field, which Strapi doesn't natively support.";
    displayName: 'Digest Video Title';
  };
  attributes: {
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
  };
}

export interface ContentDigestViewingOrder extends Struct.ComponentSchema {
  collectionName: 'components_content_digest_viewing_orders';
  info: {
    description: "One entry in the recommended viewing sequence for a digest's source videos. Populated only when order matters (one video is prerequisite to another).";
    displayName: 'Digest Viewing Order';
  };
  attributes: {
    videoTitle: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
    why: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
  };
}

export interface ContentSection extends Struct.ComponentSchema {
  collectionName: 'components_content_sections';
  info: {
    description: 'A content section. `timeSec` is optional \u2014 populated for video posts (clickable seek), omitted for articles/blogs.';
    displayName: 'Section';
  };
  attributes: {
    body: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2000;
      }>;
    heading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    timeSec: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
  };
}

export interface ContentTakeaway extends Struct.ComponentSchema {
  collectionName: 'components_content_takeaways';
  info: {
    description: 'A single key-takeaway bullet. Repeatable on posts (video summaries, future articles/blogs).';
    displayName: 'Takeaway';
  };
  attributes: {
    text: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 280;
      }>;
  };
}

export interface LessonCallout extends Struct.ComponentSchema {
  collectionName: 'components_lesson_callouts';
  info: {
    description: 'Aside or warning.';
    displayName: 'Callout';
  };
  attributes: {
    body: Schema.Attribute.Text & Schema.Attribute.Required;
    source: Schema.Attribute.Component<'lesson.source', false>;
    tone: Schema.Attribute.Enumeration<['note', 'tip', 'warning']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'note'>;
  };
}

export interface LessonDegreeChips extends Struct.ComponentSchema {
  collectionName: 'components_lesson_degree_chips';
  info: {
    description: 'Scale-degree chips. Maps to DegreeChips.';
    displayName: 'Degree chips';
  };
  attributes: {
    degrees: Schema.Attribute.JSON & Schema.Attribute.Required;
    size: Schema.Attribute.Enumeration<['sm', 'md']> &
      Schema.Attribute.DefaultTo<'md'>;
  };
}

export interface LessonDiagram extends Struct.ComponentSchema {
  collectionName: 'components_lesson_diagrams';
  info: {
    description: 'A fretboard diagram (guitar or bass). mode=theory stores musical parameters and computes dots at render; mode=explicit stores hand-placed dots. Position-addressed (string/fret) \u2014 keyboard diagrams use lesson.keyboard-diagram instead, which is pitch-class-addressed. Every field that can be an enum is one: a closed set is impossible for an LLM to get wrong under JSON-mode decoding, where a freeform array is not.';
    displayName: 'Diagram';
  };
  attributes: {
    caption: Schema.Attribute.String;
    dots: Schema.Attribute.Component<'lesson.neck-dot', true>;
    fromFret: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    instrument: Schema.Attribute.Enumeration<['guitar', 'bass']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'guitar'>;
    inversion: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 2;
          min: 0;
        },
        number
      >;
    mode: Schema.Attribute.Enumeration<['theory', 'explicit']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'theory'>;
    quality: Schema.Attribute.Enumeration<
      ['major', 'minor', 'augmented', 'diminished']
    >;
    root: Schema.Attribute.Enumeration<
      ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    >;
    source: Schema.Attribute.Component<'lesson.source', false>;
    stringSet: Schema.Attribute.Enumeration<
      [
        'e\u2013B\u2013G',
        'B\u2013G\u2013D',
        'G\u2013D\u2013A',
        'D\u2013A\u2013E',
      ]
    >;
    toFret: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    useParam: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
  };
}

export interface LessonHeading extends Struct.ComponentSchema {
  collectionName: 'components_lesson_headings';
  info: {
    description: 'Standalone heading between blocks. Headings inside a prose body stay in its markdown.';
    displayName: 'Heading';
  };
  attributes: {
    level: Schema.Attribute.Enumeration<['h2', 'h3']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'h2'>;
    text: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface LessonKeyMark extends Struct.ComponentSchema {
  collectionName: 'components_lesson_key_marks';
  info: {
    description: 'One explicit mark on a keyboard diagram, addressed by pitch class rather than position. Mirrors KeyMark in client/src/components/lesson/MiniKeyboard.tsx.';
    displayName: 'Key mark';
  };
  attributes: {
    flag: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    label: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 8;
      }>;
    pc: Schema.Attribute.Enumeration<
      ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    > &
      Schema.Attribute.Required;
    root: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
  };
}

export interface LessonKeyboardDiagram extends Struct.ComponentSchema {
  collectionName: 'components_lesson_keyboard_diagrams';
  info: {
    description: "A piano/keyboard diagram, addressed by pitch class rather than fretboard position. mode=theory stores musical parameters and computes marks at render; mode=explicit stores hand-placed marks. Split from lesson.diagram (which is fretboard-only, guitar/bass) because MiniKeyboard's marks are pitch-class-addressed, a different shape than MiniNeck's position-addressed dots \u2014 stringSet/inversion/fromFret/toFret would be meaningless-but-structurally-valid here.";
    displayName: 'Keyboard diagram';
  };
  attributes: {
    caption: Schema.Attribute.String;
    marks: Schema.Attribute.Component<'lesson.key-mark', true>;
    mode: Schema.Attribute.Enumeration<['theory', 'explicit']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'theory'>;
    octaves: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 3;
          min: 1;
        },
        number
      >;
    quality: Schema.Attribute.Enumeration<
      ['major', 'minor', 'augmented', 'diminished']
    >;
    root: Schema.Attribute.Enumeration<
      ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    >;
    source: Schema.Attribute.Component<'lesson.source', false>;
    useParam: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
  };
}

export interface LessonNeckDot extends Struct.ComponentSchema {
  collectionName: 'components_lesson_neck_dots';
  info: {
    description: 'One explicit dot on a fretboard/keyboard diagram. Mirrors NeckDot in client/src/components/lesson/MiniNeck.tsx.';
    displayName: 'Neck dot';
  };
  attributes: {
    dim: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    fret: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    label: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 8;
      }>;
    root: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    string: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 5;
          min: 0;
        },
        number
      >;
  };
}

export interface LessonParamPicker extends Struct.ComponentSchema {
  collectionName: 'components_lesson_param_pickers';
  info: {
    description: 'Renders the control for the lesson-level parameter.';
    displayName: 'Parameter picker';
  };
  attributes: {
    label: Schema.Attribute.String;
  };
}

export interface LessonParameter extends Struct.ComponentSchema {
  collectionName: 'components_lesson_parameters';
  info: {
    description: 'One reader-controlled variable for the whole lesson. Blocks opt in via useParam. Capped at one per lesson.';
    displayName: 'Lesson parameter';
  };
  attributes: {
    default: Schema.Attribute.Enumeration<
      ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    > &
      Schema.Attribute.DefaultTo<'C'>;
    label: Schema.Attribute.String & Schema.Attribute.DefaultTo<'Key'>;
    name: Schema.Attribute.Enumeration<['key']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'key'>;
  };
}

export interface LessonProse extends Struct.ComponentSchema {
  collectionName: 'components_lesson_proses';
  info: {
    description: 'Markdown body. Covers paragraphs, lists and inline headings.';
    displayName: 'Prose';
  };
  attributes: {
    body: Schema.Attribute.RichText & Schema.Attribute.Required;
    source: Schema.Attribute.Component<'lesson.source', false>;
  };
}

export interface LessonSource extends Struct.ComponentSchema {
  collectionName: 'components_lesson_sources';
  info: {
    description: 'Provenance for a block: which video and moment it came from. Empty for hand-migrated lessons; populated by AI generation in phase 2.';
    displayName: 'Block source';
  };
  attributes: {
    timeSec: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    videoId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 32;
      }>;
  };
}

export interface LessonStep extends Struct.ComponentSchema {
  collectionName: 'components_lesson_steps';
  info: {
    description: 'Numbered step. Maps to the Step component.';
    displayName: 'Step';
  };
  attributes: {
    body: Schema.Attribute.RichText;
    lede: Schema.Attribute.Text;
    number: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    source: Schema.Attribute.Component<'lesson.source', false>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface LessonTable extends Struct.ComponentSchema {
  collectionName: 'components_lesson_tables';
  info: {
    description: 'Headers plus rows. useParam recomputes cells from the lesson parameter.';
    displayName: 'Table';
  };
  attributes: {
    caption: Schema.Attribute.String;
    headers: Schema.Attribute.JSON & Schema.Attribute.Required;
    rows: Schema.Attribute.JSON & Schema.Attribute.Required;
  };
}

export interface LessonVideoRef extends Struct.ComponentSchema {
  collectionName: 'components_lesson_video_refs';
  info: {
    description: 'Link into a library video at a timecode.';
    displayName: 'Video reference';
  };
  attributes: {
    label: Schema.Attribute.String;
    timeSec: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    videoId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 32;
      }>;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'content.action-step': ContentActionStep;
      'content.digest-contradiction': ContentDigestContradiction;
      'content.digest-contradiction-position': ContentDigestContradictionPosition;
      'content.digest-shared-theme': ContentDigestSharedTheme;
      'content.digest-unique-insight': ContentDigestUniqueInsight;
      'content.digest-video-title': ContentDigestVideoTitle;
      'content.digest-viewing-order': ContentDigestViewingOrder;
      'content.section': ContentSection;
      'content.takeaway': ContentTakeaway;
      'lesson.callout': LessonCallout;
      'lesson.degree-chips': LessonDegreeChips;
      'lesson.diagram': LessonDiagram;
      'lesson.heading': LessonHeading;
      'lesson.key-mark': LessonKeyMark;
      'lesson.keyboard-diagram': LessonKeyboardDiagram;
      'lesson.neck-dot': LessonNeckDot;
      'lesson.param-picker': LessonParamPicker;
      'lesson.parameter': LessonParameter;
      'lesson.prose': LessonProse;
      'lesson.source': LessonSource;
      'lesson.step': LessonStep;
      'lesson.table': LessonTable;
      'lesson.video-ref': LessonVideoRef;
    }
  }
}
