# Routing Framework - Example Output

This example demonstrates the complete output structure when the router selects `three_levels_listening` for a triangulation case.

## Example: Gatekeeper/Triangulation Case

**Client Statement:**
"I translate for my wife and mom so they don't get hurt. I tell my wife Mom is just worried, and I tell Mom my wife is just tired. Why do I feel so exhausted if I'm doing such a good thing?"

**Router Output:**

```json
{
  "routing_decision": {
    "selected_framework": "three_levels_listening",
    "confidence": "high",
    "rationale": "Client is engaging in 'Triangulation' (blocking direct communication between mother and sister) but frames it as 'doing a good thing'. Encouraging this behavior would reinforce the pathological dynamic. Deep listening and process analysis is needed to help client see the interpersonal cost of the gatekeeping role."
  },
  "client_statement_analysis": {
    "primary_indicators": [
      "Client positioned as intermediary in family communication",
      "Defensive framing ('I'm helping') masking underlying dynamic",
      "Lack of awareness about process-level implications"
    ],
    "contraindications": [
      "No explicit expressions of hopelessness or self-blame that would trigger resource_focused_encouragement"
    ],
    "therapeutic_urgency": "routine"
  },
  "framework_output": {
    // Output from three_levels_listening framework (see listening.md)
    "analysis": {
      "level_1_content": "Client reports serving as communication intermediary between mother and sister, filtering and managing their interactions.",
      "level_2_emotion": "Primary: Pride, helpfulness. Complex/Hidden: Anxiety about family conflict, need for control, fear of being excluded.",
      "level_3_process": "Client is operating from a belief that they must manage others' relationships to maintain family stability. The dynamic appears to be Triangulation with client as gatekeeper. The function of this statement is to seek validation for a role that provides perceived importance but perpetuates enmeshment."
    },
    "suggested_response": {
      "focus": "Deep Empathy (Levels 2 & 3)",
      "draft_response": "It sounds like you feel responsible for keeping peace between your mom and sister, and perhaps deep down you're worried about what might happen if they communicated directly... I'm wondering what it's like for you to carry that weight?"
    }
  },
  "metadata": {
    "alternative_frameworks_considered": [
      {
        "framework": "resource_focused_encouragement",
        "score": 0.3,
        "reason_not_selected": "Client is not expressing deficit-based thinking about self; behavior is ego-syntonic and requires process exploration rather than reframing"
      }
    ]
  }
}
```

## Key Insights

- The router correctly identifies triangulation dynamics
- It selects deep listening over encouragement because validating the gatekeeping role would reinforce dysfunction
- The embedded framework output shows all three levels of analysis
- Alternative frameworks are tracked with reasoning for transparency
