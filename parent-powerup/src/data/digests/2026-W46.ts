import type { Digest } from '../../types';

/**
 * This Week, 9 November 2026. Publications from 28 October to 5 November 2026 (one dated
 * November 2026 by month only). Every item is a real paper, summarised from its PubMed abstract.
 */
export const digest: Digest = {
  week: '2026-W46',
  weekOf: '2026-11-09',
  title: 'Phones, playgrounds and your own wellbeing',
  editorNote:
    'This week: what helps teens loosen the pull of their phones, how children can stand up to bullying, and a reminder that looking after yourself is part of looking after them. Plus a quick tip for the baby food aisle.',
  items: [
    {
      id: 'w46-teen-social-media-sleep',
      kind: 'study',
      headline: 'Less social media and more sleep linked to less teen drinking and vaping',
      summary:
        'Researchers followed 16,914 Canadian secondary school students, aged roughly 12 to 18, for a year, looking at how they split their day between sleep, exercise and different kinds of screen use. Teens who spent relatively more of their day on social media and online chat were more likely to drink, smoke, vape or use cannabis a year later, while those who slept longer were less likely to. Swapping 30 minutes a day of social media for sleep or exercise was linked to slightly lower odds of all four.',
      takeaway:
        'This does not show that social media causes substance use, but protecting sleep looks like a good bet. Rather than a blanket screen limit, you could agree a phone-free hour before bed, and keep talking together about what they see and share online.',
      issues: ['screens', 'sleep', 'risk'],
      ages: { from: 12, to: 18 },
      source: {
        title:
          'Time-use composition between sleep, screen use, and physical activity: one-year longitudinal associations with substance use in Canadian adolescents.',
        authors: 'Tozetto WR, Lopes MVV, Chaput JP, et al.',
        journal: 'Addictive Behaviors',
        published: '2026-11-03',
        pmid: '43019816',
        doi: '10.1016/j.addbeh.2026.108895',
        url: 'https://pubmed.ncbi.nlm.nih.gov/43019816/',
      },
    },
    {
      id: 'w46-exercise-breaks-phones',
      kind: 'study',
      headline: 'Short bursts of exercise at school breaks cut teens’ phone use in a trial',
      summary:
        'In a school trial, 386 secondary school pupils in 12 classes were randomly assigned, class by class, to four 2-minute bursts of vigorous exercise during breaks each day, or to their usual routine. After four months, the exercise group scored lower on a phone overuse scale and spent about 52 fewer minutes a day on screens, as measured by their devices. Some of the gains faded once the guided programme stopped.',
      takeaway:
        'Short bursts of movement may help loosen a phone’s pull, and they do not need to be long. You could suggest a quick active break, like a walk or a kick about, before reaching for the phone, though so far this has only been tested in schools.',
      issues: ['screens', 'school'],
      ages: { from: 12, to: 18 },
      source: {
        title:
          'Effectiveness of Exercise Snacks in Mitigating Adolescent Problematic Smartphone Use: A Four-Wave Cluster Randomized Controlled Trial.',
        authors: 'Li L, Peng B, Liu J, et al.',
        journal: 'Scandinavian Journal of Medicine & Science in Sports',
        published: '2026-11',
        pmid: '42925061',
        doi: '10.1111/sms.70388',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42925061/',
      },
    },
    {
      id: 'w46-bystander-bullying',
      kind: 'review',
      headline: 'Teaching children who witness bullying to step in helps reduce it',
      summary:
        'This review pooled 23 controlled studies of school programmes that teach pupils who see bullying how to step in or get help. The programmes cut the risk of being bullied by about a third and the risk of bullying others by about a quarter, and the evidence for these face-to-face outcomes was rated high certainty. There was no clear effect on cyberbullying, or on how often children actually stood up for others.',
      takeaway:
        'Children who see bullying can make a real difference. You could talk through what they might do, such as standing with the child being picked on, saying ‘that’s not OK’, or telling a trusted adult, and ask whether their school runs a programme like this.',
      issues: ['friends', 'school'],
      ages: { from: 5, to: 18 },
      source: {
        title: 'Effects of bystander interventions on school bullying: a systematic review and meta-analysis.',
        authors: 'Bezerra LLAL, Florêncio RS, Alves DLG, et al.',
        journal: 'Revista da Escola de Enfermagem da USP',
        published: '2026-11-02',
        pmid: '42987270',
        doi: '10.1590/1980-220X-REEUSP-2026-0029en',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42987270/',
      },
    },
    {
      id: 'w46-nut-allergy-school-rules',
      kind: 'study',
      headline: 'Nut-free school rules were not linked to more bullying or worry',
      summary:
        'Researchers surveyed 652 children with a peanut or tree nut allergy (median age 6) and their parents, comparing those whose nursery or school restricted nuts with those whose did not. Restrictions were not linked to more allergy-related bullying, or to more anxiety in children or parents. At nursery and primary school age, children at settings with restrictions had a better allergy-related quality of life.',
      takeaway:
        'If your child has a nut allergy, this suggests nut-free rules are unlikely to single them out, and may help younger children feel better day to day. It is a survey, so it shows links rather than proof.',
      issues: ['school', 'anxiety', 'risk'],
      ages: { from: 1, to: 18 },
      source: {
        title:
          'Do School Food Allergy Policies Harm or Help? Quality of Life, Anxiety, and Bullying in Children with Peanut and Tree Nut Allergy.',
        authors: "Gray A, Ruran HB, D'Ambrosi G, et al.",
        journal: 'Journal of Allergy and Clinical Immunology',
        published: '2026-10-28',
        pmid: '42950957',
        doi: '10.1016/j.jaci.2026.10.011',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42950957/',
      },
    },
    {
      id: 'w46-parent-wellbeing-programmes',
      kind: 'study',
      headline: 'Parenting support helped babies most when carers’ own mental health was good',
      summary:
        'In a trial across 100 rural villages in China, 2,554 carers of babies aged 6 to 24 months either had weekly one-to-one parenting sessions at a local centre for a year, or no programme. The sessions boosted children’s thinking and language skills, but only when carers did not have symptoms of depression, anxiety or stress at the start. For carers who were struggling, there was no clear benefit, because stimulating play at home did not increase in the same way.',
      takeaway:
        'Your own wellbeing is part of your child’s wellbeing, not a luxury. If you are feeling low, anxious or stretched, getting support for yourself is a real way of helping your child, and never a sign of failure.',
      issues: ['connection', 'feelings'],
      ages: { from: 0.5, to: 2 },
      source: {
        title: 'Association of Caregiver Mental Health and a Childhood Parenting Intervention in China.',
        authors: 'Jiang Q, Qian Y, Wang B, et al.',
        journal: 'Pediatrics',
        published: '2026-11-01',
        pmid: '42863843',
        doi: '10.1542/peds.2026-076649',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42863843/',
      },
    },
    {
      id: 'w46-sugar-labels-baby-food',
      kind: 'study',
      headline: 'Clear added sugar labels helped parents pick less sugary baby foods',
      summary:
        'In an experiment, 533 Australian parents of babies and toddlers were randomly shown baby and toddler food packs with or without a warning label for added sugar, then picked the one they would most likely buy. With labels, 27% chose a product with added sugar, compared with 43% without. The labels also helped parents spot added sugar far more accurately (89% against 61%).',
      takeaway:
        'Pouches and snacks made for little ones can carry hidden sugar. Until labels are clearer, a quick look at the ingredients for words like sugar, syrup or fruit juice concentrate is a simple check.',
      issues: ['eating'],
      ages: { from: 0.5, to: 3 },
      source: {
        title:
          'Countering Sweet Deception: A Field Experiment Testing the Impact of Added Sugar Warning Labels on Parental Perceptions and Purchasing Preferences for Commercial Infant and Toddler Foods.',
        authors: 'Dixon HG, Scully M, Awoke MA, et al.',
        journal: 'Nutrients',
        published: '2026-11-05',
        pmid: '43030300',
        doi: '10.3390/nu18213673',
        url: 'https://pubmed.ncbi.nlm.nih.gov/43030300/',
      },
    },
  ],
};
