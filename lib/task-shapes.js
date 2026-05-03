const TASK_SHAPES = [
  {
    id: "career_email",
    label: "Career outreach email",
    triggers: [/\b(email|message|note|outreach)\b/i, /\b(role|job|hiring|recruiter|ae|account executive|interview|application|resume|linkedin|career)\b/i],
    requiredSlots: [
      { id: "intent", label: "Action", weight: 1, patterns: [/\b(write|draft|compose|rewrite)\b/i] },
      { id: "recipient", label: "Recipient", weight: 2, patterns: [/\b(to|addressed to|head of|vp|director|recruiter)\b/i] },
      { id: "role", label: "Role title", weight: 2, patterns: [/\b(account executive|enterprise ae|\bae\b|sdr|bdr|sales manager|solutions engineer|role title|open role)\b/i] },
      { id: "purpose", label: "Purpose", weight: 2, patterns: [/\b(interested|interest|apply|application|opportunity|role|job|opening)\b/i] },
      { id: "background", label: "Background/proof", weight: 2, patterns: [/\b(my|i have|i've|i bring|with my)\b.{0,100}\b(experience|background|quota|closed|pipeline|deal|fit|wins)\b/i, /\b(resume|linkedin|deal sheet|\$\d+|m\+|years?)\b/i] },
      { id: "tone", label: "Tone", weight: 1, patterns: [/\b(tone|professional|warm|concise|friendly|direct|thoughtful|formal|personable)\b/i] },
      { id: "cta", label: "Call to action", weight: 2, patterns: [/\b(call|meeting|conversation|intro|introduction|referral|reply|connect|chat|next step)\b/i] }
    ],
    scaffold: "Write an email to [Name], [recipient context] about [purpose]. Include [your relevant background, proof points, or fit], use a [tone] tone, and ask for [CTA]."
  },
  {
    id: "general_email",
    label: "Email or message",
    triggers: [/\b(email|message|note|reply|outreach)\b/i, /\b(to|for|recipient|client|customer|manager|team|boss|founder)\b/i],
    requiredSlots: [
      { id: "intent", label: "Action", weight: 1, patterns: [/\b(write|draft|compose|reply|rewrite)\b/i] },
      { id: "recipient", label: "Recipient", weight: 2, patterns: [/\b(to|for|recipient|client|customer|manager|team|boss|founder)\b/i] },
      { id: "purpose", label: "Purpose", weight: 2, patterns: [/\b(about|regarding|because|purpose|goal|request|follow up|intro|meeting)\b/i] },
      { id: "context", label: "Key context", weight: 2, patterns: [/\b(include|context|background|details|points|mention)\b/i] },
      { id: "tone", label: "Tone", weight: 1, patterns: [/\b(tone|professional|warm|concise|friendly|direct|formal)\b/i] },
      { id: "cta", label: "Next step", weight: 1, patterns: [/\b(ask|cta|next step|reply|call|meeting|confirm|approve)\b/i] }
    ],
    scaffold: "Write an email to [recipient] about [purpose]. Include [key context], use a [tone] tone, and ask for [desired next step]."
  },
  {
    id: "ux_ui_design",
    label: "UX/UI design",
    triggers: [/\b(ui|ux|design|wireframe|prototype|screen|flow|component|layout|figma|web app)\b/i],
    requiredSlots: [
      { id: "artifact", label: "Screen/flow/component", weight: 2, patterns: [/\b(app|web app|screen|flow|component|dashboard|page|form|checkout|onboarding)\b/i] },
      { id: "user", label: "Target user", weight: 2, patterns: [/\b(for|user|users|customer|persona|audience|admin|manager|rep|buyer)\b/i] },
      { id: "goal", label: "User/business goal", weight: 2, patterns: [/\b(goal|so they can|to enable|optimize|increase|reduce|improve|manage|forecast|track|create|review)\b/i] },
      { id: "workflow", label: "Screens/workflow", weight: 2, patterns: [/\b(screen|workflow|flow|journey|dashboard|settings|profile|home|search|checkout)\b/i] },
      { id: "constraints", label: "Style/platform constraints", weight: 1, patterns: [/\b(style|brand|design system|mobile|desktop|responsive|accessibility|constraints)\b/i] },
      { id: "output", label: "Output format", weight: 1, patterns: [/\b(wireframe|spec|layout|components|states|copy|interaction notes)\b/i] }
    ],
    scaffold: "Design [screen/flow/component] for [target user]. Optimize for [goal], include [core screens or workflows], follow [visual/style constraints], and return [wireframe/spec/component breakdown]."
  },
  {
    id: "code_build",
    label: "Build or implement",
    triggers: [/\b(build|create|code|implement|develop)\b/i, /\b(app|website|webpage|api|component|function|script|feature|tool)\b/i],
    requiredSlots: [
      { id: "deliverable", label: "Product/feature", weight: 2, patterns: [/\b(app|website|api|component|function|script|feature|tool)\b/i] },
      { id: "user", label: "User/audience", weight: 1, patterns: [/\b(for|user|users|customer|admin|team)\b/i] },
      { id: "stack", label: "Tech stack", weight: 2, patterns: [/\b(react|next|node|python|javascript|typescript|swift|ios|android|flutter|rails|django|sql|chrome extension|stack)\b/i] },
      { id: "requirements", label: "Core functionality", weight: 2, patterns: [/\b(should|must|needs to|feature|requirements|functionality|allow|enable)\b/i] },
      { id: "constraints", label: "Constraints", weight: 1, patterns: [/\b(auth|database|performance|style|dependencies|constraints|desktop|security|offline|responsive)\b/i] },
      { id: "output", label: "Output deliverable", weight: 1, patterns: [/\b(code|implementation|steps|architecture|tests|files)\b/i] }
    ],
    scaffold: "Build [product/feature] for [user/audience] using [tech stack/platform]. It should [core functionality], follow [constraints], and return [deliverable format]."
  },
  {
    id: "debug",
    label: "Debug or fix",
    triggers: [/\b(debug|fix|bug|error|broken|crash|traceback|stack trace)\b/i],
    requiredSlots: [
      { id: "system", label: "Code/system", weight: 2, patterns: [/\b(code|function|component|api|app|system|script|query|bug)\b/i] },
      { id: "stack", label: "Tech stack", weight: 1, patterns: [/\b(react|next|node|python|javascript|typescript|sql|ios|android|stack)\b/i] },
      { id: "actual", label: "Current behavior", weight: 2, patterns: [/\b(current|currently|actual|happening|does|shows|returns)\b/i] },
      { id: "expected", label: "Expected behavior", weight: 2, patterns: [/\b(should|expected|instead|want|supposed to)\b/i] },
      { id: "error", label: "Error/logs/context", weight: 2, patterns: [/\b(error|logs|traceback|exception|screenshot|stack|fails|crashes)\b/i] },
      { id: "output", label: "Fix deliverable", weight: 1, patterns: [/\b(fix|explain|tests|patch|root cause)\b/i] }
    ],
    scaffold: "Debug [code/system] in [tech stack]. Current behavior: [actual behavior]. Expected behavior: [expected behavior]. Error/logs: [error]. Return [fix, explanation, and tests]."
  },
  {
    id: "data_analysis",
    label: "Data analysis",
    triggers: [/\b(data analysis|analyze data|dataset|dashboard|metrics|kpi|cohort|segmentation|forecast)\b/i],
    requiredSlots: [
      { id: "source", label: "Dataset/source", weight: 2, patterns: [/\b(data|dataset|csv|table|source|report|spreadsheet)\b/i] },
      { id: "question", label: "Question", weight: 2, patterns: [/\b(answer|question|find|understand|why|what|how|insight)\b/i] },
      { id: "metrics", label: "Metrics/dimensions", weight: 2, patterns: [/\b(metric|kpi|revenue|conversion|retention|cohort|segment|dimension)\b/i] },
      { id: "assumptions", label: "Assumptions/caveats", weight: 1, patterns: [/\b(assume|caveat|missing|exclude|filter|timeframe)\b/i] },
      { id: "format", label: "Output format", weight: 1, patterns: [/\b(chart|charts|table|insights|bullets|recommendation|recommendations|dashboard)\b/i] }
    ],
    scaffold: "Analyze [dataset/source] to answer [business question]. Focus on [metrics/segments], note [assumptions], and return [insights, charts, or recommendations]."
  },
  {
    id: "data_modeling",
    label: "Data modeling",
    triggers: [/\b(data model|schema|entity relationship|erd|warehouse model|dimensional model)\b/i],
    requiredSlots: [
      { id: "process", label: "Business process/product", weight: 2, patterns: [/\b(for|product|process|system|workflow|app|billing|subscription)\b/i] },
      { id: "entities", label: "Entities", weight: 2, patterns: [/\b(entity|entities|objects|tables|customers|orders|users|events|subscriptions|invoices|payments|plans)\b/i] },
      { id: "relationships", label: "Relationships", weight: 2, patterns: [/\b(relationship|relationships|belongs|has many|joins|foreign key|foreign keys|connects)\b/i] },
      { id: "constraints", label: "Constraints", weight: 1, patterns: [/\b(scale|privacy|reporting|analytics|normalization|constraints)\b/i] },
      { id: "format", label: "Output format", weight: 1, patterns: [/\b(schema|erd|sql|tables|diagram)\b/i] }
    ],
    scaffold: "Design a data model for [business process/product]. Include [entities], [relationships], [constraints], and return [schema/ERD/tables]."
  },
  {
    id: "compare_decide",
    label: "Compare or decide",
    triggers: [/\b(compare|recommend|choose|decide|evaluate|versus|vs\.?)\b/i],
    requiredSlots: [
      { id: "options", label: "Options", weight: 2, patterns: [/\b(and|vs|versus|between|option|vendor|tool|platform)\b/i] },
      { id: "goal", label: "Decision goal", weight: 2, patterns: [/\b(for|goal|decide|choose|selection|use case)\b/i] },
      { id: "criteria", label: "Criteria", weight: 2, patterns: [/\b(criteria|cost|price|features|security|ease|roi|priority)\b/i] },
      { id: "tradeoffs", label: "Trade-offs", weight: 1, patterns: [/\b(tradeoff|trade-off|risk|constraint|priority|must-have)\b/i] },
      { id: "format", label: "Output format", weight: 1, patterns: [/\b(table|scorecard|ranking|recommendation|pros|cons)\b/i] }
    ],
    scaffold: "Compare [option A] and [option B] for [decision goal]. Evaluate using [criteria], prioritize [trade-offs], and return [format] with a clear recommendation."
  },
  {
    id: "plan_strategy",
    label: "Plan or strategy",
    triggers: [/\b(plan|strategy|roadmap|schedule|launch|timeline|milestones)\b/i],
    requiredSlots: [
      { id: "goal", label: "Goal", weight: 2, patterns: [/\b(goal|plan for|strategy for|launch|achieve|objective)\b/i] },
      { id: "timeframe", label: "Timeframe", weight: 1, patterns: [/\b(day|week|weeks|month|months|quarter|year|timeline|timeframe)\b/i] },
      { id: "constraints", label: "Constraints/stakeholders", weight: 2, patterns: [/\b(constraint|budget|team|stakeholder|resources|dependencies)\b/i] },
      { id: "detail", label: "Level of detail", weight: 1, patterns: [/\b(step-by-step|milestones|high-level|detailed|checklist)\b/i] },
      { id: "success", label: "Success criteria", weight: 1, patterns: [/\b(success|metric|kpi|measure|outcome)\b/i] }
    ],
    scaffold: "Create a plan for [goal] over [timeframe]. Account for [constraints/stakeholders], include [level of detail], and define [success criteria]."
  }
];

function getTaskShape(id) {
  return TASK_SHAPES.find((shape) => shape.id === id) || TASK_SHAPES.find((shape) => shape.id === "plan_strategy");
}

function detectTaskShape(text) {
  if (/\b(debug|fix|bug|error|broken|crash|traceback|stack trace)\b/i.test(text)) return "debug";
  if (/\b(data model|schema|entity relationship|erd|warehouse model|dimensional model)\b/i.test(text)) return "data_modeling";
  if (/\b(compare|recommend|choose|decide|evaluate|versus|vs\.?)\b/i.test(text)) return "compare_decide";
  if (/\b(plan|strategy|roadmap|schedule|launch|timeline|milestones)\b/i.test(text)) return "plan_strategy";
  if (/\b(ui|ux|design|wireframe|prototype|screen|flow|layout|figma|web app)\b/i.test(text)) return "ux_ui_design";
  if (/\b(data analysis|analyze data|csv|dataset|metrics|kpi|cohort|segmentation|forecast)\b/i.test(text)) return "data_analysis";
  if (/\b(email|message|note|reply|outreach)\b/i.test(text) && /\b(role|job|hiring|recruiter|ae|account executive|interview|application|resume|linkedin|career)\b/i.test(text)) return "career_email";
  if (/\b(email|message|note|reply|outreach)\b/i.test(text)) return "general_email";
  if (/\b(build|create|code|implement|develop)\b/i.test(text) && /\b(app|website|webpage|api|component|function|script|feature|tool)\b/i.test(text)) return "code_build";

  const matches = TASK_SHAPES
    .map((shape) => ({
      shape,
      score: shape.triggers.filter((pattern) => pattern.test(text)).length
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return matches[0]?.shape.id || "plan_strategy";
}

function scoreTaskShape(text, shapeId) {
  const shape = getTaskShape(shapeId);
  const maxScore = shape.requiredSlots.reduce((sum, slot) => sum + slot.weight, 0);
  const present = [];
  const missing = [];

  shape.requiredSlots.forEach((slot) => {
    const matched = slot.patterns.some((pattern) => pattern.test(text));
    if (matched) present.push(slot.id);
    else missing.push(slot.id);
  });

  const score = shape.requiredSlots.reduce((sum, slot) => (
    present.includes(slot.id) ? sum + slot.weight : sum
  ), 0);

  return { shape, score, maxScore, present, missing, ready: score >= Math.ceil(maxScore * 0.8) && missing.length <= 1 };
}

module.exports = {
  TASK_SHAPES,
  detectTaskShape,
  getTaskShape,
  scoreTaskShape
};
