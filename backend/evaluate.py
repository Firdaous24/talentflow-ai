"""Reproducible field/skill evaluation on programmatically generated fictional PDFs."""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent / 'tests'))
from multilingual_support import FIXTURES, make_layout_pdf
from app.models.candidate import CandidateProfile
from app.services.extraction import DeterministicCandidateExtractor
from app.services.pdf import extract_pdf

def flatten(value, path=''):
    result = {}
    if isinstance(value, dict):
        for key, item in value.items():
            result.update(flatten(item, f'{path}.{key}' if path else key))
    elif isinstance(value, list):
        # Skill list order is not meaningful; match canonical names instead.
        for i, item in enumerate(value):
            key = item['name'] if path == 'technical_skills' else str(item) if path.split('.')[-1] == 'technologies' else str(i)
            result.update(flatten(item, f'{path}.{key}'))
    elif value is not None and value != '':
        result[path] = value
    return result

def evaluate(fixtures=None, render=None):
    fixtures = FIXTURES if fixtures is None else fixtures
    render = make_layout_pdf if render is None else render
    total = dict(correct=0, predicted=0, expected=0, unsupported=0, skill_correct=0, skill_predicted=0, skill_expected=0, exact_profiles=0)
    cases = []
    associations = {name: {'correct': 0, 'expected': 0} for name in ['job_titles', 'employers', 'experience_dates', 'education_records', 'project_records']}
    for fixture in fixtures:
        document = extract_pdf(render(fixture))
        response = DeterministicCandidateExtractor().extract(document)
        predicted = response.candidate.model_dump(mode='json')
        truth = fixture['ground_truth']
        # The same evaluator can load a pre-location parser snapshot. Keep the
        # new authored field in the denominator instead of dropping its misses.
        compatible_truth = {**truth, 'experience': [{key: value for key, value in row.items() if key != 'location'} for row in truth.get('experience', [])], 'technical_skills': [{**row, 'category': 'tool' if row['category'] == 'web_technology' else row['category']} for row in truth.get('technical_skills', [])]}
        expected = CandidateProfile.model_validate(compatible_truth).model_dump(mode='json')
        for row, original in zip(expected['experience'], truth.get('experience', [])):
            row['location'] = original.get('location')
        for row, original in zip(expected['technical_skills'], truth.get('technical_skills', [])):
            row['category'] = original['category']
        p, e = flatten(predicted), flatten(expected)
        correct = sum(key in e and value == e[key] for key, value in p.items())
        unsupported = sum(key not in e or value != e[key] for key, value in p.items())
        ps, es = {s['name'] for s in predicted['technical_skills']}, {s['name'] for s in expected['technical_skills']}
        total['correct'] += correct; total['predicted'] += len(p); total['expected'] += len(e); total['unsupported'] += unsupported
        total['skill_correct'] += len(ps & es); total['skill_predicted'] += len(ps); total['skill_expected'] += len(es)
        exact = p == e; total['exact_profiles'] += exact
        for index, row in enumerate(expected['experience']):
            for field, metric in [('job_title', 'job_titles'), ('company', 'employers'), ('start_date', 'experience_dates'), ('end_date', 'experience_dates')]:
                if row.get(field):
                    associations[metric]['expected'] += 1
                    associations[metric]['correct'] += index < len(predicted['experience']) and predicted['experience'][index].get(field) == row[field]
        for collection, metric in [('education', 'education_records'), ('projects', 'project_records')]:
            for index, row in enumerate(expected[collection]):
                associations[metric]['expected'] += 1
                associations[metric]['correct'] += index < len(predicted[collection]) and flatten(predicted[collection][index]) == flatten(row)
        cases.append({'id': fixture['id'], 'correct': correct, 'predicted': len(p), 'expected': len(e), 'exact': exact,
                      'differences': {key: {'expected': e.get(key), 'actual': p.get(key)} for key in sorted(set(p) | set(e)) if p.get(key) != e.get(key)}})
    return {'dataset_size': len(fixtures), 'counts': total, 'metrics': {
        'field_precision': total['correct'] / total['predicted'] if total['predicted'] else 0,
        'field_recall': total['correct'] / total['expected'] if total['expected'] else 0,
        'exact_structured_profile_rate': total['exact_profiles'] / len(fixtures),
        'skill_precision': total['skill_correct'] / total['skill_predicted'] if total['skill_predicted'] else 0,
        'skill_recall': total['skill_correct'] / total['skill_expected'] if total['skill_expected'] else 0,
        'unsupported_field_rate': total['unsupported'] / total['predicted'] if total['predicted'] else 0,
    }, 'association_counts': associations, 'cases': cases}

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', choices=['multilingual', 'accuracy'], default='multilingual')
    args = parser.parse_args()
    if args.dataset == 'accuracy':
        from accuracy_support import REGRESSION_FIXTURES, make_accuracy_pdf
        result = evaluate(REGRESSION_FIXTURES, make_accuracy_pdf)
    else:
        result = evaluate()
    print(json.dumps(result, ensure_ascii=False, indent=2))
