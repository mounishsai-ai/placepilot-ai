"""
Synthetic data generator — creates 10 companies + 200 students + drives.
Run: python -m seed.generate_data
"""
import json
import random
from faker import Faker
from datetime import datetime, timedelta

fake = Faker("en_IN")
random.seed(42)

BRANCHES = ["CSE", "IT", "ECE", "EEE", "ME", "CE", "MCA", "Data Science"]
SKILLS_POOL = [
    "Python", "Java", "C++", "JavaScript", "TypeScript", "React", "Node.js",
    "FastAPI", "Django", "Spring Boot", "SQL", "PostgreSQL", "MongoDB",
    "Machine Learning", "Deep Learning", "TensorFlow", "PyTorch", "NLP",
    "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Linux", "Git",
    "Data Structures", "Algorithms", "System Design", "REST APIs", "GraphQL",
    "Flutter", "Android", "iOS", "Swift", "Kotlin", "DevOps", "CI/CD",
    "Tableau", "Power BI", "Excel", "Statistics", "R",
]

PROFICIENCY = ["beginner", "intermediate", "expert"]

COMPANIES = [
    {"name": "TCS Digital", "sector": "IT Services", "website": "https://tcs.com"},
    {"name": "Infosys InStep", "sector": "IT Services", "website": "https://infosys.com"},
    {"name": "Wipro Technologies", "sector": "IT Services", "website": "https://wipro.com"},
    {"name": "Google India", "sector": "Product", "website": "https://google.com"},
    {"name": "Microsoft IDC", "sector": "Product", "website": "https://microsoft.com"},
    {"name": "Amazon India", "sector": "E-Commerce / Cloud", "website": "https://amazon.in"},
    {"name": "Deloitte USI", "sector": "Consulting", "website": "https://deloitte.com"},
    {"name": "Capgemini India", "sector": "IT Services", "website": "https://capgemini.com"},
    {"name": "Cognizant", "sector": "IT Services", "website": "https://cognizant.com"},
    {"name": "HCL Technologies", "sector": "IT Services", "website": "https://hcltech.com"},
]

JD_TEMPLATES = [
    {
        "role": "Software Development Engineer",
        "package_lpa": 12.0,
        "min_cgpa": 7.0,
        "max_backlogs": 0,
        "allowed_branches": ["CSE", "IT", "ECE"],
        "required_skills": ["Python", "Data Structures", "Algorithms", "SQL"],
        "preferred_skills": ["Machine Learning", "React", "Docker"],
        "selection_process": ["Aptitude Test", "Coding Round", "Technical Interview", "HR Interview"],
    },
    {
        "role": "Data Analyst",
        "package_lpa": 8.5,
        "min_cgpa": 6.5,
        "max_backlogs": 1,
        "allowed_branches": ["CSE", "IT", "Data Science", "MCA"],
        "required_skills": ["Python", "SQL", "Excel", "Statistics"],
        "preferred_skills": ["Tableau", "Power BI", "Machine Learning"],
        "selection_process": ["Aptitude Test", "Technical Interview", "HR Interview"],
    },
    {
        "role": "Full Stack Developer",
        "package_lpa": 10.0,
        "min_cgpa": 7.5,
        "max_backlogs": 0,
        "allowed_branches": ["CSE", "IT"],
        "required_skills": ["JavaScript", "React", "Node.js", "SQL"],
        "preferred_skills": ["TypeScript", "Docker", "AWS"],
        "selection_process": ["Aptitude Test", "Coding Round", "Technical Interview", "HR Interview"],
    },
    {
        "role": "Cloud Engineer",
        "package_lpa": 11.0,
        "min_cgpa": 7.0,
        "max_backlogs": 0,
        "allowed_branches": ["CSE", "IT", "ECE"],
        "required_skills": ["AWS", "Linux", "Docker", "Python"],
        "preferred_skills": ["Kubernetes", "Terraform", "CI/CD"],
        "selection_process": ["Aptitude Test", "Technical Interview", "HR Interview"],
    },
    {
        "role": "Machine Learning Engineer",
        "package_lpa": 14.0,
        "min_cgpa": 8.0,
        "max_backlogs": 0,
        "allowed_branches": ["CSE", "IT", "Data Science"],
        "required_skills": ["Python", "Machine Learning", "Deep Learning", "TensorFlow"],
        "preferred_skills": ["PyTorch", "NLP", "MLOps"],
        "selection_process": ["Aptitude Test", "Coding Round", "Technical Interview", "HR Interview"],
    },
]


def gen_students(n: int = 200) -> list[dict]:
    students = []
    for i in range(n):
        branch = random.choice(BRANCHES)
        cgpa = round(random.uniform(5.5, 10.0), 2)
        num_skills = random.randint(3, 10)
        skills = [
            {
                "skill": s,
                "proficiency": random.choice(PROFICIENCY),
                "years_experience": round(random.uniform(0, 2), 1),
            }
            for s in random.sample(SKILLS_POOL, num_skills)
        ]
        name = fake.name()
        students.append({
            "roll_no": f"2024{branch[:2].upper()}{str(i+1).zfill(4)}",
            "name": name,
            "email": f"{name.lower().replace(' ', '.')}{i}@college.edu",
            "phone": fake.phone_number()[:13],
            "branch": branch,
            "batch": 2025,
            "cgpa": cgpa,
            "backlogs_active": random.choices([0, 1, 2], weights=[80, 15, 5])[0],
            "backlogs_historical": random.choices([0, 1, 2, 3], weights=[70, 15, 10, 5])[0],
            "attendance_pct": round(random.uniform(65, 100), 1),
            "linkedin_url": f"https://linkedin.com/in/{name.lower().replace(' ', '-')}{i}",
            "placement_readiness_score": round(min(100, cgpa * 10 + random.uniform(-10, 10)), 1),
            "skills": skills,
        })
    return students


def gen_companies() -> list[dict]:
    companies = []
    for i, c in enumerate(COMPANIES):
        companies.append({
            "id": f"company_{i+1:03d}",
            **c,
        })
    return companies


def gen_drives(companies: list[dict]) -> list[dict]:
    drives = []
    for i, (company, jd_tmpl) in enumerate(zip(companies, JD_TEMPLATES)):
        deadline = datetime.now() + timedelta(days=random.randint(7, 30))
        jd_text = f"""
Job Title: {jd_tmpl['role']}

Company: {company['name']} | Sector: {company['sector']}

Package: {jd_tmpl['package_lpa']} LPA

Eligibility Criteria:
- Minimum CGPA: {jd_tmpl['min_cgpa']}
- Active Backlogs: Maximum {jd_tmpl['max_backlogs']}
- Eligible Branches: {', '.join(jd_tmpl['allowed_branches'])}
- Batch: 2025

Required Skills:
{chr(10).join(f'• {s}' for s in jd_tmpl['required_skills'])}

Preferred Skills:
{chr(10).join(f'• {s}' for s in jd_tmpl['preferred_skills'])}

Selection Process:
{chr(10).join(f'{j+1}. {s}' for j, s in enumerate(jd_tmpl['selection_process']))}

Job Description:
We are looking for talented freshers to join our team as {jd_tmpl['role']}.
You will work on cutting-edge projects and collaborate with experienced engineers.
Location: Multiple locations across India.

Application Deadline: {deadline.strftime('%Y-%m-%d')}
        """.strip()

        drives.append({
            "id": f"drive_{i+1:03d}",
            "company_id": company["id"],
            "title": f"{company['name']} — {jd_tmpl['role']} 2025",
            "jd_text": jd_text,
            "jd_parsed": {**jd_tmpl, "deadline": deadline.isoformat()},
            "role": jd_tmpl["role"],
            "package_lpa": jd_tmpl["package_lpa"],
            "deadline": deadline.isoformat(),
        })
    return drives


if __name__ == "__main__":
    data = {
        "companies": gen_companies(),
        "students": gen_students(200),
        "drives": gen_drives(gen_companies()),
    }
    with open("seed/data.json", "w") as f:
        json.dump(data, f, indent=2, default=str)
    print(f"Generated: {len(data['companies'])} companies, {len(data['students'])} students, {len(data['drives'])} drives")
    print("Output: seed/data.json")
