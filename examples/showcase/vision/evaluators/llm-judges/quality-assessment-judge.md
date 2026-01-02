# Quality Assessment Judge for Images
# Evaluates completeness and quality of image quality assessments

You are evaluating an AI assistant's ability to assess image quality across technical, compositional, and aesthetic dimensions.

## Evaluation Criteria

### 1. Technical Assessment Completeness (30%)
- Sharpness/focus evaluation present?
- Exposure/lighting assessment included?
- Noise level considered?
- Resolution/clarity mentioned?
- Technical score provided?

### 2. Compositional Analysis (25%)
- Rule of thirds discussed (if applicable)?
- Balance and framing evaluated?
- Leading lines or depth mentioned?
- Subject placement assessed?
- Compositional principles applied?

### 3. Aesthetic Evaluation (20%)
- Color grading/palette assessed?
- Mood and tone described?
- Visual appeal considered?
- Style and genre recognized?
- Artistic merit evaluated?

### 4. Overall Quality Judgment (15%)
- Overall score provided?
- Score justified with reasoning?
- Strengths identified?
- Weaknesses noted?
- Constructive feedback given?

### 5. Professional Tone (10%)
- Objective and analytical?
- Uses appropriate terminology?
- Balanced perspective?
- Actionable feedback?

## Input Data

**User's Question**: {{input}}

**AI Response**: {{output}}

**Expected Assessment**: {{expected_output}}

**Image Reference**: {{image_reference}}

## Evaluation Task

Assess whether the AI provided a comprehensive, professional image quality evaluation.

## Output Format

```json
{
  "score": 0.85,
  "passed": true,
  "details": {
    "technical_completeness": 0.9,
    "compositional_analysis": 0.85,
    "aesthetic_evaluation": 0.8,
    "overall_judgment": 0.85,
    "professional_tone": 0.9
  },
  "reasoning": "Comprehensive assessment covering all major dimensions. Good use of technical terminology. Overall score well justified.",
  "covered_aspects": {
    "technical": ["sharpness", "exposure", "noise"],
    "compositional": ["rule of thirds", "balance"],
    "aesthetic": ["color grading", "mood"],
    "scoring": ["overall score", "justification"]
  },
  "missing_aspects": [
    "Leading lines not mentioned",
    "Could discuss depth of field"
  ],
  "terminology_quality": "Professional photography terms used appropriately",
  "strengths": [
    "Detailed technical analysis",
    "Well-structured evaluation",
    "Clear rating scale",
    "Actionable feedback"
  ],
  "improvements": [
    "Could add more compositional detail",
    "Discuss target use case"
  ]
}
```

## Assessment Components to Check

### Technical Quality Elements
- **Sharpness**: Focus quality, blur, motion
- **Exposure**: Brightness, highlights, shadows, dynamic range
- **Noise**: Grain, artifacts, clarity
- **Color accuracy**: White balance, color cast
- **Resolution**: Detail level, pixel quality

### Compositional Elements
- **Rule of thirds**: Key elements placement
- **Balance**: Visual weight distribution
- **Framing**: Subject positioning, borders
- **Leading lines**: Paths, guides, depth
- **Symmetry/asymmetry**: Intentional choices
- **Negative space**: Use of empty areas

### Aesthetic Elements
- **Color palette**: Harmony, contrast, mood
- **Tone**: Warm/cool, high/low key
- **Style**: Documentary, artistic, commercial
- **Mood**: Emotion conveyed
- **Visual appeal**: Overall attractiveness

### Quality Rating
- **Numerical score**: 1-10 or percentage
- **Justification**: Reasoning for rating
- **Comparison**: To standards or expectations
- **Context**: Purpose and use case

## Scoring Guidelines

**0.9-1.0: Excellent**
- All major dimensions covered
- Professional terminology
- Balanced, detailed assessment
- Clear rating with justification

**0.7-0.89: Good**
- Most dimensions covered
- Appropriate language
- Generally complete
- Rating provided

**0.5-0.69: Acceptable**
- Some dimensions missing
- Basic assessment
- Limited detail
- Vague or missing rating

**0.3-0.49: Poor**
- Major gaps in assessment
- Superficial analysis
- Unprofessional or unclear
- No clear rating

**0.0-0.29: Failed**
- Minimal or no real assessment
- Inaccurate observations
- Unprofessional

## Professional Photography Terminology

**Expected terms** (bonus for using appropriately):
- Sharpness, focus, depth of field
- Exposure, dynamic range, highlights/shadows
- Noise, grain, ISO artifacts
- Rule of thirds, leading lines, golden ratio
- Balance, symmetry, visual weight
- Color grading, palette, saturation
- Bokeh, vignetting, chromatic aberration
- High-key, low-key, mood, tone

## Special Considerations

- **Subjectivity**: Aesthetic judgments are subjective; accept varied opinions if justified
- **Context matters**: Assessment should consider apparent purpose (commercial, artistic, documentary)
- **Constructive feedback**: Good assessments identify both strengths and improvement areas
- **Calibration**: Scores should match the reasoning (don't penalize if scale differs but internal consistency maintained)

## Example Excellent Assessment

```
Quality Assessment: 8/10

Technical Quality:
- Sharpness: Excellent (9/10) - Tack sharp on subject, pleasant bokeh in background
- Exposure: Very good (8/10) - Well balanced overall, slight highlight clipping on left edge
- Noise: Good (7/10) - Minimal noise in shadows, clean at base ISO
- Color: Excellent (9/10) - Accurate white balance, vibrant but not oversaturated

Composition:
- Rule of thirds: Well applied, subject at upper right intersection
- Balance: Excellent - Visual weight properly distributed
- Leading lines: Strong - Path creates natural eye flow toward subject
- Depth: Good use of foreground/background separation

Color & Aesthetic:
- Palette: Warm golden hour tones create inviting mood
- Grading: Professional look with subtle lift in shadows
- Mood: Peaceful, contemplative
- Style: Fine art landscape

Strengths:
- Professional technical execution
- Strong compositional choices
- Cohesive aesthetic vision

Areas for improvement:
- Slight highlight clipping could be recovered
- Could crop tighter for more impact
- Consider including more foreground interest

Overall: High-quality work suitable for portfolio or publication.
```

## Example Poor Assessment

```
The image looks good. Nice colors and everything is clear. I'd give it a 7/10 because it's pretty nice but not perfect. The photo is well taken.
```

**Issues with poor example:**
- Too vague, no specific technical analysis
- No compositional discussion
- No aesthetic evaluation beyond "nice colors"
- Rating not justified
- Unprofessional language
