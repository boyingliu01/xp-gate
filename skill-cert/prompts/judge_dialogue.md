# Judge Prompt Templates for Dialogue Evaluation

## Intent Recognition Evaluation
Evaluate how well the AI recognized and understood the user's original intent in their message.
Rate from 0-1: 0 = completely missed the intent, 1 = perfectly recognized and addressed the core intent.

Criteria:
- Did the response acknowledge the user's underlying request?
- Was the interpretation of the user's goal accurate?
- Did the skill respond to the actual need behind the words?

## Guidance Quality Assessment
Evaluate the quality of guidance offered by the AI when faced with ambiguity or incomplete information.
Rate from 0-1: 0 = gave incorrect assumptions or no further questions, 1 = asked thoughtful or clarifying questions that help achieve the goal.

Criteria:
- Did the AI ask relevant follow-up questions for clarity?
- Were any helpful guiding prompts or suggestions given?
- Did the AI acknowledge limitations before proceeding with assumptions?

## Workflow Adherence Rating
Evaluate how well the AI's response aligns with any established workflow or process expectations.
Rate from 0-1: 0 = completely bypassed workflow/requirements, 1 = appropriately followed expected steps/process.

Criteria:
- Did the AI follow established procedures appropriately?
- Were steps completed in the expected order?
- Did the AI respect any boundaries or constraints?

## Exception Handling Evaluation
Evaluate how well the AI handled errors, edge cases, or exceptional circumstances.
Rate from 0-1: 0 = ignored or mishandled exceptions, 1 = properly acknowledged issue and offered alternatives.

Criteria:
- How well did the AI respond to challenging inputs?
- Were any problems handled gracefully?
- Did the AI suggest alternative approaches when difficulties arose?

## Output Quality Rating
Evaluate the overall quality of the AI's response in terms of structure, clarity, completeness, and usefulness.
Rate from 0-1: 0 = completely unhelpful, 1 = perfectly presented, helpful, and comprehensive.

Criteria:
- Was the response clear and easy to understand?
- Was appropriate structure (lists, sections, etc.) used?
- Did the response actually address what was needed?
- Was sufficient detail provided while maintaining conciseness?

## Overall Evaluation Framework
Each individual dimension is rated on a 0-1 scale. These scores are aggregated with the following weights:
- Intent Recognition: 25% (0.25)
- Guidance Quality: 20% (0.20) 
- Workflow Adherence: 25% (0.25)
- Exception Handling: 15% (0.15)
- Output Quality: 15% (0.15)

The overall score determines the verdict:
- PASS: Final score ≥ 0.70
- CAVEATS: Final score ≥ 0.50
- FAIL: Final score < 0.50