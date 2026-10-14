# Corpus quality report

Chunks file: `data\generated\chunks.jsonl`  
Documents: **104** (45 PDFs, 43%), chunks: **12735**, documents passing all heuristics: **101/104**

## Per library

| library | docs | ok | PDFs | chunks |
|---|---|---|---|---|
| classic-books | 6 | 6 | 0 | 1753 |
| copyright-office | 7 | 7 | 7 | 138 |
| django-docs | 7 | 7 | 0 | 273 |
| earth-and-space | 4 | 4 | 4 | 313 |
| health-guides | 4 | 3 | 4 | 506 |
| home-hazards | 4 | 3 | 4 | 133 |
| money-and-home | 5 | 5 | 5 | 661 |
| python-tutorial | 8 | 8 | 0 | 309 |
| rust-book | 8 | 8 | 0 | 195 |
| security-standards | 7 | 7 | 7 | 1827 |
| tax-help | 7 | 7 | 7 | 1869 |
| us-founding-documents | 9 | 9 | 0 | 1845 |
| wikipedia-history | 7 | 7 | 0 | 755 |
| wikipedia-science | 7 | 7 | 0 | 683 |
| wikipedia-technology | 7 | 7 | 0 | 582 |
| workplace-safety | 7 | 6 | 7 | 893 |

## Per document

| document | library | chunks | chars | alpha | short lines | mean chunk | verdict |
|---|---|---|---|---|---|---|---|
| cfpb-your-home-loan-toolkit.pdf | money-and-home | 75 | 71576 | 0.753 | 0.278 | 947 | ok |
| copyright-circular-01-copyright-basics.pdf | copyright-office | 34 | 31174 | 0.793 | 0.203 | 914 | ok |
| copyright-circular-02-copyright-registration.pdf | copyright-office | 24 | 22403 | 0.795 | 0.232 | 930 | ok |
| copyright-circular-03-copyright-notice.pdf | copyright-office | 15 | 13383 | 0.778 | 0.045 | 888 | ok |
| copyright-circular-09-works-made-for-hire.pdf | copyright-office | 17 | 15472 | 0.772 | 0.077 | 909 | ok |
| copyright-circular-14-derivative-works.pdf | copyright-office | 18 | 17056 | 0.796 | 0.0 | 945 | ok |
| copyright-circular-15a-duration-of-copyright.pdf | copyright-office | 13 | 12395 | 0.756 | 0.0 | 952 | ok |
| copyright-circular-33-works-not-protected.pdf | copyright-office | 17 | 15854 | 0.79 | 0.0 | 929 | ok |
| django-howto-deployment-checklist.txt | django-docs | 14 | 12607 | 0.732 | 0.078 | 894 | ok |
| django-intro-tutorial01.txt | django-docs | 16 | 13769 | 0.711 | 0.17 | 821 | ok |
| django-intro-tutorial02.txt | django-docs | 36 | 30429 | 0.715 | 0.121 | 813 | ok |
| django-intro-tutorial03.txt | django-docs | 26 | 22972 | 0.698 | 0.116 | 849 | ok |
| django-topics-db-models.txt | django-docs | 96 | 80948 | 0.706 | 0.167 | 794 | ok |
| django-topics-http-urls.txt | django-docs | 49 | 42753 | 0.705 | 0.116 | 833 | ok |
| django-topics-templates.txt | django-docs | 36 | 32179 | 0.726 | 0.12 | 856 | ok |
| epa-brief-guide-to-mold-moisture.pdf | home-hazards | 23 | 20908 | 0.784 | 0.47 | 907 | short-lines |
| epa-citizens-guide-to-radon.pdf | home-hazards | 40 | 37618 | 0.775 | 0.345 | 938 | ok |
| epa-protect-your-family-from-lead.pdf | home-hazards | 34 | 31566 | 0.765 | 0.319 | 927 | ok |
| epa-renovate-right-lead-hazard-brochure.pdf | home-hazards | 36 | 34191 | 0.782 | 0.403 | 948 | ok |
| federal-reserve-purposes-and-functions-ch1.pdf | money-and-home | 14 | 13287 | 0.789 | 0.15 | 946 | ok |
| federal-reserve-purposes-and-functions-ch3-monetary-policy.pdf | money-and-home | 105 | 101752 | 0.801 | 0.009 | 967 | ok |
| federal-reserve-purposes-and-functions-ch4-financial-stability.pdf | money-and-home | 51 | 48613 | 0.799 | 0.055 | 951 | ok |
| federal-reserve-the-fed-explained.pdf | money-and-home | 416 | 395405 | 0.806 | 0.058 | 948 | ok |
| gutenberg-1-declaration-of-independence.txt | us-founding-documents | 40 | 38529 | 0.778 | 0.064 | 930 | ok |
| gutenberg-11-alices-adventures-in-wonderland.txt | classic-books | 219 | 211529 | 0.734 | 0.113 | 931 | ok |
| gutenberg-132-the-art-of-war.txt | classic-books | 442 | 427929 | 0.753 | 0.097 | 941 | ok |
| gutenberg-1404-the-federalist-papers-part1of4.txt | us-founding-documents | 417 | 371660 | 0.812 | 0.05 | 890 | ok |
| gutenberg-1404-the-federalist-papers-part2of4.txt | us-founding-documents | 410 | 371337 | 0.811 | 0.037 | 904 | ok |
| gutenberg-1404-the-federalist-papers-part3of4.txt | us-founding-documents | 409 | 370258 | 0.812 | 0.042 | 904 | ok |
| gutenberg-1404-the-federalist-papers-part4of4.txt | us-founding-documents | 409 | 365911 | 0.807 | 0.04 | 893 | ok |
| gutenberg-16-peter-pan.txt | classic-books | 367 | 355068 | 0.745 | 0.153 | 935 | ok |
| gutenberg-1952-the-yellow-wallpaper.txt | classic-books | 68 | 65527 | 0.756 | 0.125 | 928 | ok |
| gutenberg-2-bill-of-rights.txt | us-founding-documents | 30 | 28494 | 0.774 | 0.09 | 913 | ok |
| gutenberg-3-jfk-inaugural-address.txt | us-founding-documents | 36 | 34531 | 0.769 | 0.064 | 927 | ok |
| gutenberg-36-the-war-of-the-worlds.txt | classic-books | 474 | 458512 | 0.774 | 0.072 | 944 | ok |
| gutenberg-5-united-states-constitution.txt | us-founding-documents | 63 | 60683 | 0.779 | 0.125 | 930 | ok |
| gutenberg-8-lincoln-second-inaugural-address.txt | us-founding-documents | 31 | 30032 | 0.777 | 0.063 | 935 | ok |
| gutenberg-844-the-importance-of-being-earnest.txt | classic-books | 183 | 177617 | 0.744 | 0.398 | 930 | ok |
| irs-publication-463-travel-gift-car-expenses.pdf | tax-help | 362 | 352626 | 0.744 | 0.059 | 973 | ok |
| irs-publication-501-dependents-standard-deduction.pdf | tax-help | 259 | 252912 | 0.752 | 0.0 | 975 | ok |
| irs-publication-502-medical-and-dental-expenses.pdf | tax-help | 151 | 146604 | 0.775 | 0.0 | 970 | ok |
| irs-publication-523-selling-your-home.pdf | tax-help | 159 | 153926 | 0.736 | 0.011 | 967 | ok |
| irs-publication-590a-ira-contributions.pdf | tax-help | 349 | 337419 | 0.7 | 0.013 | 965 | ok |
| irs-publication-936-home-mortgage-interest.pdf | tax-help | 127 | 123220 | 0.748 | 0.037 | 969 | ok |
| irs-publication-970-tax-benefits-for-education.pdf | tax-help | 462 | 449764 | 0.759 | 0.018 | 971 | ok |
| nasa-artemis-ii-press-kit.pdf | earth-and-space | 66 | 61875 | 0.768 | 0.365 | 933 | ok |
| nasa-webb-fact-sheet.pdf | earth-and-space | 4 | 3921 | 0.809 | 0.0 | 980 | ok |
| nhlbi-dash-eating-plan-guide.pdf | health-guides | 92 | 83982 | 0.712 | 0.761 | 907 | short-lines |
| nhlbi-your-guide-to-a-healthy-heart.pdf | health-guides | 193 | 183677 | 0.739 | 0.406 | 947 | ok |
| nhlbi-your-guide-to-healthy-sleep.pdf | health-guides | 136 | 128414 | 0.771 | 0.243 | 943 | ok |
| nhlbi-your-guide-to-physical-activity-and-your-heart.pdf | health-guides | 85 | 78440 | 0.725 | 0.286 | 918 | ok |
| nist-cswp-29-cybersecurity-framework-2.pdf | security-standards | 91 | 87099 | 0.793 | 0.049 | 953 | ok |
| nist-sp-800-171r2-protecting-cui.pdf | security-standards | 383 | 366147 | 0.755 | 0.171 | 950 | ok |
| nist-sp-800-207-zero-trust-architecture.pdf | security-standards | 206 | 196594 | 0.77 | 0.112 | 951 | ok |
| nist-sp-800-30r1-risk-assessments.pdf | security-standards | 421 | 403429 | 0.786 | 0.041 | 955 | ok |
| nist-sp-800-61r2-incident-handling-guide.pdf | security-standards | 308 | 289076 | 0.79 | 0.106 | 937 | ok |
| nist-sp-800-63-3-digital-identity-guidelines.pdf | security-standards | 202 | 191066 | 0.768 | 0.246 | 942 | ok |
| nist-sp-800-88r1-media-sanitization.pdf | security-standards | 216 | 205741 | 0.776 | 0.078 | 949 | ok |
| osha-3021-workers-rights.pdf | workplace-safety | 61 | 59510 | 0.785 | 0.092 | 974 | ok |
| osha-3071-job-hazard-analysis.pdf | workplace-safety | 71 | 65552 | 0.701 | 0.697 | 921 | short-lines |
| osha-3088-workplace-emergencies-evacuations.pdf | workplace-safety | 63 | 58147 | 0.711 | 0.185 | 917 | ok |
| osha-3122-principal-emergency-response.pdf | workplace-safety | 207 | 197133 | 0.719 | 0.145 | 949 | ok |
| osha-3151-personal-protective-equipment.pdf | workplace-safety | 93 | 85992 | 0.752 | 0.367 | 913 | ok |
| osha-3170-safeguarding-equipment.pdf | workplace-safety | 228 | 221404 | 0.786 | 0.097 | 967 | ok |
| osha-small-business-safety-handbook.pdf | workplace-safety | 170 | 162549 | 0.768 | 0.198 | 944 | ok |
| python-tutorial-03-introduction.txt | python-tutorial | 28 | 24480 | 0.619 | 0.353 | 818 | ok |
| python-tutorial-04-control-flow.txt | python-tutorial | 61 | 52420 | 0.65 | 0.304 | 798 | ok |
| python-tutorial-05-data-structures.txt | python-tutorial | 42 | 35621 | 0.615 | 0.318 | 799 | ok |
| python-tutorial-06-modules.txt | python-tutorial | 35 | 31722 | 0.692 | 0.209 | 863 | ok |
| python-tutorial-07-input-and-output.txt | python-tutorial | 31 | 26535 | 0.668 | 0.231 | 820 | ok |
| python-tutorial-08-errors-and-exceptions.txt | python-tutorial | 38 | 31829 | 0.649 | 0.305 | 763 | ok |
| python-tutorial-09-classes.txt | python-tutorial | 58 | 48877 | 0.717 | 0.226 | 802 | ok |
| python-tutorial-10-standard-library-tour.txt | python-tutorial | 16 | 14340 | 0.663 | 0.22 | 848 | ok |
| rust-book-ch03-01-variables-and-mutability.md | rust-book | 14 | 11929 | 0.766 | 0.041 | 851 | ok |
| rust-book-ch03-02-data-types.md | rust-book | 26 | 22066 | 0.721 | 0.082 | 839 | ok |
| rust-book-ch04-01-what-is-ownership.md | rust-book | 38 | 32509 | 0.752 | 0.063 | 854 | ok |
| rust-book-ch04-02-references-and-borrowing.md | rust-book | 14 | 13066 | 0.759 | 0.032 | 932 | ok |
| rust-book-ch06-01-defining-an-enum.md | rust-book | 24 | 20215 | 0.749 | 0.171 | 839 | ok |
| rust-book-ch08-01-vectors.md | rust-book | 17 | 14731 | 0.746 | 0.078 | 865 | ok |
| rust-book-ch09-02-recoverable-errors-with-result.md | rust-book | 41 | 34198 | 0.734 | 0.086 | 829 | ok |
| rust-book-ch10-01-generic-data-types.md | rust-book | 21 | 18457 | 0.736 | 0.169 | 875 | ok |
| usgs-this-dynamic-earth.pdf | earth-and-space | 208 | 197103 | 0.788 | 0.038 | 946 | ok |
| usgs-this-dynamic-planet.pdf | earth-and-space | 35 | 33712 | 0.786 | 0.0 | 962 | ok |
| wikipedia-antibiotic.txt | wikipedia-science | 74 | 61837 | 0.828 | 0.144 | 834 | ok |
| wikipedia-apollo-11.txt | wikipedia-history | 125 | 104065 | 0.789 | 0.162 | 831 | ok |
| wikipedia-black-hole.txt | wikipedia-science | 113 | 95984 | 0.752 | 0.402 | 791 | ok |
| wikipedia-crispr-gene-editing.txt | wikipedia-science | 99 | 80209 | 0.816 | 0.191 | 808 | ok |
| wikipedia-domain-name-system.txt | wikipedia-technology | 82 | 68388 | 0.793 | 0.178 | 832 | ok |
| wikipedia-first-transcontinental-railroad.txt | wikipedia-history | 147 | 124559 | 0.792 | 0.092 | 846 | ok |
| wikipedia-global-positioning-system.txt | wikipedia-technology | 132 | 111615 | 0.743 | 0.359 | 790 | ok |
| wikipedia-great-fire-of-london.txt | wikipedia-history | 60 | 52405 | 0.795 | 0.126 | 872 | ok |
| wikipedia-hubble-space-telescope.txt | wikipedia-history | 135 | 112153 | 0.8 | 0.165 | 829 | ok |
| wikipedia-lithium-ion-battery.txt | wikipedia-technology | 88 | 71730 | 0.75 | 0.27 | 755 | ok |
| wikipedia-magna-carta.txt | wikipedia-history | 111 | 89081 | 0.795 | 0.277 | 801 | ok |
| wikipedia-panama-canal.txt | wikipedia-history | 119 | 97880 | 0.779 | 0.108 | 821 | ok |
| wikipedia-periodic-table.txt | wikipedia-science | 143 | 122576 | 0.802 | 0.117 | 856 | ok |
| wikipedia-photosynthesis.txt | wikipedia-science | 77 | 63348 | 0.821 | 0.179 | 821 | ok |
| wikipedia-plate-tectonics.txt | wikipedia-science | 92 | 75987 | 0.814 | 0.156 | 824 | ok |
| wikipedia-public-key-cryptography.txt | wikipedia-technology | 33 | 27271 | 0.815 | 0.257 | 824 | ok |
| wikipedia-qr-code.txt | wikipedia-technology | 71 | 60928 | 0.662 | 0.395 | 743 | ok |
| wikipedia-rosetta-stone.txt | wikipedia-history | 58 | 49905 | 0.802 | 0.108 | 859 | ok |
| wikipedia-solid-state-drive.txt | wikipedia-technology | 67 | 54206 | 0.796 | 0.228 | 807 | ok |
| wikipedia-transmission-control-protocol.txt | wikipedia-technology | 109 | 91296 | 0.783 | 0.187 | 836 | ok |
| wikipedia-vaccine.txt | wikipedia-science | 85 | 68287 | 0.822 | 0.176 | 802 | ok |

## Flagged

- `epa-brief-guide-to-mold-moisture.pdf` (home-hazards): short-lines
- `nhlbi-dash-eating-plan-guide.pdf` (health-guides): short-lines
- `osha-3071-job-hazard-analysis.pdf` (workplace-safety): short-lines
