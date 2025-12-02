# Spec: ACE Optimization

## ADDED Requirements

### CLI Command: `optimize`

The CLI shall support an `optimize` command to trigger the optimization process.

#### Scenario: Run optimization
Given a valid optimizer configuration file `ace-config.yaml`
When I run `agentv optimize ace-config.yaml`
Then the optimization process starts
And progress is displayed in the terminal
And the playbook is updated upon completion

### Configuration: ACE Type

The system shall support parsing and validating optimizer configurations with `type: ace`.

#### Scenario: Valid configuration
Given a YAML file with:
```yaml
type: ace
eval_files: ["./evals/test.yaml"]
playbook_path: "./playbooks/code.json"
max_epochs: 5
```
When the configuration is loaded
Then it is recognized as an ACE optimizer configuration
And all fields are correctly parsed

### Execution: Run Evals

The optimizer shall execute the specified evaluation files to measure performance.

#### Scenario: Evaluation during optimization
Given an optimizer running an epoch
When it needs to evaluate the current performance
Then it runs the test cases defined in `eval_files`
And aggregates the results into a score

### Output: Playbook

The optimizer shall save the learned optimization data to the specified `playbook_path`.

#### Scenario: Save playbook
Given an optimization run completes successfully
When the process finishes
Then a JSON file is created or updated at `playbook_path`
And it contains the learned playbook data
