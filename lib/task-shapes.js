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
    triggers: [/\b(compare|recommend|choose|decide|versus|vs\.?)\b/i],
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
    id: "sql_database",
    label: "SQL or database",
    triggers: [/\b(sql|query|database|postgres|mysql|snowflake|bigquery|join)\b/i],
    requiredSlots: [
      { id: "goal", label: "Query goal", weight: 2, patterns: [/\b(find|return|calculate|count|sum|average|rank|goal|need|show)\b/i] },
      { id: "schema", label: "Tables/schema", weight: 2, patterns: [/\b(table|tables|schema|columns|database|orders|users|customers|events)\b/i] },
      { id: "filters", label: "Filters/joins", weight: 2, patterns: [/\b(where|filter|join|group by|date|between|last|active|status|segment)\b/i] },
      { id: "dialect", label: "SQL dialect", weight: 1, patterns: [/\b(postgres|mysql|snowflake|bigquery|sqlite|sql server|redshift)\b/i] },
      { id: "output", label: "Output expectation", weight: 1, patterns: [/\b(explain|optimized|performance|result|cte)\b/i] }
    ],
    scaffold: "Write [SQL/database logic] for [goal]. Use [tables/schema], account for [filters/joins/edge cases], target [SQL dialect], and return [query plus explanation]."
  },
  {
    id: "product_prd",
    label: "Product requirements",
    triggers: [/\b(prd|product spec|requirements|user story|acceptance criteria|feature spec)\b/i],
    requiredSlots: [
      { id: "feature", label: "Feature/product", weight: 2, patterns: [/\b(feature|product|prd|spec|requirements|build)\b/i] },
      { id: "users", label: "Users/personas", weight: 2, patterns: [/\b(user|users|persona|customer|admin|buyer|team)\b/i] },
      { id: "problem", label: "Problem/opportunity", weight: 2, patterns: [/\b(problem|pain|opportunity|need|goal|job to be done|jtbd)\b/i] },
      { id: "requirements", label: "Requirements", weight: 2, patterns: [/\b(requirement|must|should|acceptance criteria|user story|flow)\b/i] },
      { id: "constraints", label: "Constraints/dependencies", weight: 1, patterns: [/\b(constraint|dependency|scope|timeline|technical|legal|risk)\b/i] },
      { id: "metrics", label: "Success metrics", weight: 1, patterns: [/\b(metric|success|kpi|measure|activation|retention|conversion)\b/i] }
    ],
    scaffold: "Create a product spec for [feature/product]. Include [users], [problem/opportunity], [requirements], [constraints/dependencies], and [success metrics]."
  },
  {
    id: "marketing_copy",
    label: "Marketing or copy",
    triggers: [/\b(marketing|copy|landing page|ad copy|positioning|campaign|headline|tagline)\b/i],
    requiredSlots: [
      { id: "asset", label: "Asset", weight: 2, patterns: [/\b(landing page|ad|email|post|headline|tagline|campaign|copy)\b/i] },
      { id: "audience", label: "Audience/ICP", weight: 2, patterns: [/\b(audience|icp|customer|buyer|persona|for)\b/i] },
      { id: "goal", label: "Conversion goal", weight: 2, patterns: [/\b(goal|convert|sign up|book|download|buy|awareness|pipeline)\b/i] },
      { id: "message", label: "Positioning/message", weight: 2, patterns: [/\b(position|positioning|message|value prop|benefit|differentiator|pain)\b/i] },
      { id: "voice", label: "Voice/tone", weight: 1, patterns: [/\b(tone|voice|brand|professional|playful|premium|direct)\b/i] },
      { id: "format", label: "Format/variants", weight: 1, patterns: [/\b(variant|variants|versions|format|bullets|section|sections|short|long)\b/i] }
    ],
    scaffold: "Write [marketing asset] for [audience/ICP] to achieve [goal]. Use [positioning/message], match [voice], and return [format/variants]."
  },
  {
    id: "legal_policy",
    label: "Legal or policy review",
    triggers: [/\b(legal|contract|policy|terms|privacy|compliance|clause|risk review|msa|dpa)\b/i],
    requiredSlots: [
      { id: "document", label: "Document/policy", weight: 2, patterns: [/\b(document|policy|contract|terms|clause|agreement|msa|dpa)\b/i] },
      { id: "purpose", label: "Review purpose", weight: 2, patterns: [/\b(review|check|assess|redline|summarize|risk|negotiate)\b/i] },
      { id: "risks", label: "Risks/clauses", weight: 2, patterns: [/\b(risk|liability|privacy|termination|indemnity|compliance|data|security)\b/i] },
      { id: "context", label: "Jurisdiction/context", weight: 1, patterns: [/\b(jurisdiction|country|state|industry|vendor|customer|b2b|enterprise)\b/i] },
      { id: "format", label: "Output format", weight: 1, patterns: [/\b(summary|issues|redline|table|suggested revisions|bullets)\b/i] }
    ],
    scaffold: "Review [document/policy] for [purpose]. Focus on [risks/clauses], consider [jurisdiction/context], and return [summary, issues, and suggested revisions]."
  },
  {
    id: "finance_modeling",
    label: "Finance or modeling",
    triggers: [/\b(financial model|forecast|budget|revenue model|pricing model|roi|unit economics|valuation|margin)\b/i],
    requiredSlots: [
      { id: "model", label: "Model/analysis", weight: 2, patterns: [/\b(model|forecast|budget|roi|valuation|pricing|unit economics|margin)\b/i] },
      { id: "decision", label: "Decision/use case", weight: 2, patterns: [/\b(decision|deciding|evaluate|assess|choose|investment|pricing|plan)\b/i] },
      { id: "inputs", label: "Inputs/assumptions", weight: 2, patterns: [/\b(input|assumption|cost|growth|churn|conversion|cac|ltv|margin|runway)\b/i] },
      { id: "metrics", label: "Metrics/scenarios", weight: 2, patterns: [/\b(metric|scenario|sensitivity|margin|payback|runway|irr|npv)\b/i] },
      { id: "format", label: "Output format", weight: 1, patterns: [/\b(table|model|summary|recommendation|spreadsheet|formula)\b/i] }
    ],
    scaffold: "Build/analyze [financial model] for [decision]. Use [inputs/assumptions], evaluate [metrics/scenarios], and return [recommendation/output]."
  },
  {
    id: "ops_process",
    label: "Operations or process",
    triggers: [/\b(process|sop|workflow|operations|playbook|checklist|procedure|handoff)\b/i],
    requiredSlots: [
      { id: "workflow", label: "Workflow/process", weight: 2, patterns: [/\b(workflow|process|sop|procedure|handoff|operation)\b/i] },
      { id: "stakeholders", label: "Stakeholders", weight: 2, patterns: [/\b(team|stakeholder|owner|customer|sales|support|ops|manager)\b/i] },
      { id: "constraints", label: "Tools/constraints", weight: 2, patterns: [/\b(tool|system|constraint|sla|resource|budget|dependency)\b/i] },
      { id: "risks", label: "Failure points", weight: 1, patterns: [/\b(risk|failure|bottleneck|handoff|escalation|error)\b/i] },
      { id: "format", label: "Output format", weight: 1, patterns: [/\b(checklist|playbook|sop|steps|template|runbook)\b/i] }
    ],
    scaffold: "Create/improve a process for [workflow]. Account for [stakeholders], [tools/constraints], [failure points], and return [SOP/checklist/playbook]."
  },
  {
    id: "hiring_interview",
    label: "Hiring or interview",
    triggers: [/\b(interview|hiring|scorecard|job description|candidate|recruiting|screening)\b/i],
    requiredSlots: [
      { id: "asset", label: "Hiring asset", weight: 2, patterns: [/\b(interview|scorecard|job description|jd|screen|rubric|questions)\b/i] },
      { id: "role", label: "Role", weight: 2, patterns: [/\b(role|position|engineer|manager|designer|sales|candidate)\b/i] },
      { id: "skills", label: "Skills/signals", weight: 2, patterns: [/\b(skill|competency|signal|experience|behavior|technical|craft|systems thinking|collaboration|judgment)\b/i] },
      { id: "criteria", label: "Criteria/questions", weight: 2, patterns: [/\b(criteria|question|rubric|evaluate|score|bar)\b/i] },
      { id: "format", label: "Output format", weight: 1, patterns: [/\b(format|scorecard|table|questions|guide)\b/i] }
    ],
    scaffold: "Create [hiring/interview asset] for [role]. Evaluate [skills/signals], include [criteria/questions], and return [format]."
  },
  {
    id: "customer_support",
    label: "Customer support",
    triggers: [/\b(customer support|support reply|ticket|refund|complaint|escalation|help center|kb article)\b/i],
    requiredSlots: [
      { id: "issue", label: "Customer issue", weight: 2, patterns: [/\b(issue|problem|complaint|ticket|refund|bug|question)\b/i] },
      { id: "customer", label: "Customer context", weight: 1, patterns: [/\b(customer|user|account|plan|tier|enterprise|free)\b/i] },
      { id: "policy", label: "Policy/product context", weight: 2, patterns: [/\b(policy|refund|terms|product|feature|known issue|sla)\b/i] },
      { id: "tone", label: "Tone", weight: 1, patterns: [/\b(tone|empathetic|clear|friendly|firm|professional)\b/i] },
      { id: "resolution", label: "Resolution/next step", weight: 2, patterns: [/\b(resolve|next step|escalate|refund|workaround|timeline|ask)\b/i] }
    ],
    scaffold: "Write a support response for [customer issue]. Include [customer context], follow [policy/product context], use a [tone] tone, and provide [resolution/next step]."
  },
  {
    id: "sales_strategy",
    label: "Sales strategy",
    triggers: [/\b(sales strategy|discovery call|objection|pipeline|account plan|deal strategy|prospect|qualification)\b/i],
    requiredSlots: [
      { id: "account", label: "Account/prospect", weight: 2, patterns: [/\b(account|prospect|customer|company|buyer|stakeholder)\b/i] },
      { id: "goal", label: "Sales goal", weight: 2, patterns: [/\b(goal|book|close|qualify|advance|renew|expand|pipeline)\b/i] },
      { id: "context", label: "Deal context", weight: 2, patterns: [/\b(context|stage|pain|use case|budget|timeline|competitor|crm)\b/i] },
      { id: "constraints", label: "Constraints/risks", weight: 1, patterns: [/\b(risk|objection|constraint|blocker|procurement|security)\b/i] },
      { id: "format", label: "Output format", weight: 1, patterns: [/\b(plan|talk track|questions|email|scorecard|next steps)\b/i] }
    ],
    scaffold: "Create a sales strategy for [account/prospect] to [goal]. Use [deal context], handle [constraints/risks], and return [talk track, questions, or next steps]."
  },
  {
    id: "content_social",
    label: "Content or social",
    triggers: [/\b(blog|article|newsletter|linkedin post|tweet|thread|content calendar|script|caption)\b/i],
    requiredSlots: [
      { id: "asset", label: "Content asset", weight: 2, patterns: [/\b(blog|article|newsletter|post|thread|script|caption)\b/i] },
      { id: "audience", label: "Audience", weight: 2, patterns: [/\b(audience|readers|followers|buyers|founders|operators|developers)\b/i] },
      { id: "topic", label: "Topic/message", weight: 2, patterns: [/\b(topic|about|message|point|argument|story|idea)\b/i] },
      { id: "voice", label: "Voice/style", weight: 1, patterns: [/\b(voice|tone|style|casual|sharp|educational|personal)\b/i] },
      { id: "format", label: "Format/length", weight: 1, patterns: [/\b(length|format|sections|hook|outline|bullets|variants|words)\b/i] }
    ],
    scaffold: "Create [content asset] for [audience] about [topic/message]. Use [voice/style], include [key points], and return [format/length]."
  },
  {
    id: "summarize",
    label: "Summarize",
    triggers: [/\b(summarize|summarise|recap|condense|tl;dr|brief me)\b/i],
    requiredSlots: [
      { id: "source", label: "Source/content", weight: 2, patterns: [/\b(source|document|article|report|transcript|notes|content)\b/i] },
      { id: "audience", label: "Audience", weight: 1, patterns: [/\b(for|audience|executive|team|client|beginner)\b/i] },
      { id: "focus", label: "Focus", weight: 2, patterns: [/\b(focus|key points|risks|decisions|actions|insights)\b/i] },
      { id: "length", label: "Length/style", weight: 1, patterns: [/\b(short|concise|one-page|detailed|brief|tl;dr)\b/i] },
      { id: "format", label: "Output format", weight: 1, patterns: [/\b(bullets|table|memo|summary|action items|format)\b/i] }
    ],
    scaffold: "Summarize [source/content] for [audience]. Focus on [key points], keep it [length/style], and return [output format]."
  },
  {
    id: "explain_teach",
    label: "Explain or teach",
    triggers: [/\b(explain|teach|describe|clarify|what is|how does|why does|tutorial)\b/i],
    requiredSlots: [
      { id: "concept", label: "Concept", weight: 2, patterns: [/\b(explain|teach|what is|how does|why does|concept|topic)\b/i] },
      { id: "audience", label: "Audience level", weight: 2, patterns: [/\b(beginner|expert|technical|nontechnical|student|executive|audience)\b/i] },
      { id: "scope", label: "Scope/depth", weight: 1, patterns: [/\b(depth|brief|detailed|overview|step-by-step|focus)\b/i] },
      { id: "examples", label: "Examples/analogies", weight: 1, patterns: [/\b(example|analogy|metaphor|use case|scenario)\b/i] },
      { id: "format", label: "Output format", weight: 1, patterns: [/\b(format|bullets|lesson|tutorial|diagram|steps)\b/i] }
    ],
    scaffold: "Explain [concept] to [audience level]. Cover [specific areas], use [examples/analogies], and return [output format]."
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
  if (/\b(prd|product spec|requirements|user story|acceptance criteria|feature spec)\b/i.test(text)) return "product_prd";
  if (/\b(blog|article|newsletter|linkedin post|tweet|thread|content calendar|script|caption)\b/i.test(text)) return "content_social";
  if (/\b(compare|recommend|choose|decide|versus|vs\.?)\b/i.test(text)) return "compare_decide";
  if (/\b(sql|query|database|postgres|mysql|snowflake|bigquery|join)\b/i.test(text)) return "sql_database";
  if (/\b(financial model|revenue forecast|revenue model|pricing model|roi|unit economics|valuation|margin)\b/i.test(text)) return "finance_modeling";
  if (/\b(interview|hiring|scorecard|job description|candidate|recruiting|screening)\b/i.test(text)) return "hiring_interview";
  if (/\b(ui|ux|design|wireframe|prototype|screen|flow|layout|figma|web app)\b/i.test(text)) return "ux_ui_design";
  if (/\b(sales strategy|discovery call|objection|account plan|deal strategy|prospect|qualification)\b/i.test(text)) return "sales_strategy";
  if (/\b(plan|strategy|roadmap|schedule|launch|timeline|milestones)\b/i.test(text)) return "plan_strategy";
  if (/\b(process|sop|workflow|operations|playbook|checklist|procedure|handoff)\b/i.test(text)) return "ops_process";
  if (/\b(customer support|support reply|ticket|refund|complaint|support escalation|help center|kb article)\b/i.test(text)) return "customer_support";
  if (/\b(legal|contract|terms|privacy|compliance|clause|risk review|msa|dpa)\b/i.test(text)) return "legal_policy";
  if (/\b(summarize|summarise|recap|condense|tl;dr|brief me)\b/i.test(text)) return "summarize";
  if (/\b(explain|teach|describe|clarify|what is|how does|why does|tutorial)\b/i.test(text)) return "explain_teach";
  if (/\b(data analysis|analyze data|csv|dataset|metrics|kpi|cohort|segmentation|forecast)\b/i.test(text)) return "data_analysis";
  if (/\b(marketing|copy|landing page|ad copy|positioning|campaign|headline|tagline)\b/i.test(text)) return "marketing_copy";
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
