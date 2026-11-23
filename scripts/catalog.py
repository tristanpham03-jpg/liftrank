# Generates supabase/migrations/20261011000600_catalog.sql from this table.
# name, category, muscle, equipment, method, convention, machine, max_kg, flag_kg, popular, aliases
E = [
 ("Barbell Bench Press","chest","Chest","barbell","e1rm","total",False,500,230,1,"bench|bench press|bb bench|flat bench"),
 ("Incline Barbell Bench Press","chest","Upper chest","barbell","e1rm","total",False,400,200,12,"incline bench|incline bb bench"),
 ("Dumbbell Bench Press","chest","Chest","dumbbell","e1rm","per_dumbbell",False,120,70,10,"db bench|dumbbell press|db press"),
 ("Incline Dumbbell Bench Press","chest","Upper chest","dumbbell","e1rm","per_dumbbell",False,120,65,13,"incline db|incline dumbbell press|incline db bench"),
 ("Smith Machine Bench Press","chest","Chest","smith_machine","e1rm","total",True,500,230,20,"smith bench|smith press"),
 ("Incline Smith Press","chest","Upper chest","smith_machine","e1rm","total",True,450,200,18,"incline smith|smith incline|incline smith bench"),
 ("Machine Chest Press","chest","Chest","selectorized","e1rm","stack",True,450,250,22,"chest press|machine press|seated chest press"),
 ("Incline Machine Chest Press","chest","Upper chest","plate_loaded","e1rm","plates_total",True,600,300,24,"incline chest press|hammer incline|incline machine press"),
 ("Pec Deck","chest","Chest","selectorized","e1rm","stack",True,300,180,30,"pec fly|machine fly|butterfly|pec deck fly"),
 ("Cable Fly","chest","Chest","cable","e1rm","stack",True,150,80,34,"cable crossover|crossover|cable flye"),
 ("Dip","chest","Chest & triceps","bodyweight","max_reps","bodyweight",False,None,None,26,"dips|parallel bar dip|bodyweight dip"),
 ("Weighted Dip","chest","Chest & triceps","bodyweight","added_load_e1rm","added",False,200,100,40,"weighted dips"),
 ("Push-Up","chest","Chest","bodyweight","max_reps","bodyweight",False,None,None,28,"pushup|pushups|press up"),
 ("Deadlift","back","Posterior chain","barbell","e1rm","total",False,600,360,3,"dl|conventional deadlift|sumo deadlift|deads"),
 ("Romanian Deadlift","back","Hamstrings","barbell","e1rm","total",False,500,280,14,"rdl|romanian|stiff leg deadlift|sldl"),
 ("Barbell Row","back","Back","barbell","e1rm","total",False,400,220,11,"bent over row|bb row|pendlay row|bent row"),
 ("Chest-Supported Row","back","Back","plate_loaded","e1rm","plates_total",True,500,250,25,"chest supported row|csr|incline row"),
 ("Seated Cable Row","back","Back","cable","e1rm","stack",True,300,180,16,"cable row|low row|seated row"),
 ("T-Bar Row","back","Back","plate_loaded","e1rm","plates_total",True,500,250,23,"tbar|t bar row|landmine row"),
 ("Lat Pulldown","back","Lats","cable","e1rm","stack",True,300,170,7,"pulldown|lat pull|lat pull down|pull down"),
 ("Machine Row","back","Back","plate_loaded","e1rm","plates_total",True,500,280,27,"hammer row|iso row|high row|machine high row"),
 ("Pull-Up","back","Lats","bodyweight","max_reps","bodyweight",False,None,None,6,"pullup|pullups|pull ups"),
 ("Chin-Up","back","Lats & biceps","bodyweight","max_reps","bodyweight",False,None,None,15,"chinup|chinups|chins"),
 ("Weighted Pull-Up","back","Lats","bodyweight","added_load_e1rm","added",False,200,100,29,"weighted pullup|weighted pull ups"),
 ("Weighted Chin-Up","back","Lats & biceps","bodyweight","added_load_e1rm","added",False,200,100,31,"weighted chinup|weighted chins"),
 ("Barbell Overhead Press","shoulders","Shoulders","barbell","e1rm","total",False,300,140,5,"ohp|overhead press|military press|strict press|shoulder press"),
 ("Dumbbell Shoulder Press","shoulders","Shoulders","dumbbell","e1rm","per_dumbbell",False,100,55,17,"db shoulder press|db ohp|seated dumbbell press|dumbbell ohp"),
 ("Machine Shoulder Press","shoulders","Shoulders","selectorized","e1rm","stack",True,350,180,21,"shoulder press machine|machine ohp"),
 ("Lateral Raise","shoulders","Side delts","dumbbell","e1rm","per_dumbbell",False,60,35,19,"side raise|laterals|lat raise|db lateral raise"),
 ("Cable Lateral Raise","shoulders","Side delts","cable","e1rm","stack",True,100,50,33,"cable lateral|cable side raise"),
 ("Rear Delt Fly","shoulders","Rear delts","selectorized","e1rm","stack",True,250,130,35,"reverse fly|reverse pec deck|rear delt|rear fly"),
 ("Barbell Curl","arms","Biceps","barbell","e1rm","total",False,200,100,9,"bb curl|standing curl|bicep curl"),
 ("EZ-Bar Curl","arms","Biceps","barbell","e1rm","total",False,200,95,32,"ez curl|ez bar curl|ez bar"),
 ("Preacher Curl","arms","Biceps","barbell","e1rm","total",False,150,80,36,"preacher|preacher curls"),
 ("Dumbbell Curl","arms","Biceps","dumbbell","e1rm","per_dumbbell",False,80,40,8,"db curl|dumbbell bicep curl|db bicep curl"),
 ("Hammer Curl","arms","Biceps & forearms","dumbbell","e1rm","per_dumbbell",False,80,45,37,"hammer|hammers|hammer curls"),
 ("Cable Curl","arms","Biceps","cable","e1rm","stack",True,200,90,38,"cable bicep curl|cable curls"),
 ("Triceps Pushdown","arms","Triceps","cable","e1rm","stack",True,250,120,39,"tricep pushdown|pushdown|rope pushdown|pressdown"),
 ("Overhead Triceps Extension","arms","Triceps","cable","e1rm","stack",True,200,100,41,"overhead extension|oh tricep extension|overhead tricep"),
 ("Skull Crusher","arms","Triceps","barbell","e1rm","total",False,150,80,42,"skullcrusher|skull crushers|lying triceps extension"),
 ("Barbell Back Squat","legs","Quads & glutes","barbell","e1rm","total",False,600,320,2,"squat|back squat|bb squat|high bar|low bar"),
 ("Front Squat","legs","Quads","barbell","e1rm","total",False,450,250,43,"front squats|fsq"),
 ("Smith Squat","legs","Quads & glutes","smith_machine","e1rm","total",True,600,320,44,"smith machine squat|smith squats"),
 ("Leg Press","legs","Quads & glutes","plate_loaded","e1rm","plates_total",True,1500,700,4,"45 degree leg press|lp|sled press"),
 ("Hack Squat","legs","Quads","plate_loaded","e1rm","plates_total",True,800,400,45,"hack squat machine|hack|hacks"),
 ("Leg Extension","legs","Quads","selectorized","e1rm","stack",True,350,200,46,"leg extensions|quad extension|knee extension"),
 ("Seated Leg Curl","legs","Hamstrings","selectorized","e1rm","stack",True,300,160,47,"leg curl|seated hamstring curl"),
 ("Lying Leg Curl","legs","Hamstrings","selectorized","e1rm","stack",True,250,130,48,"prone leg curl|lying hamstring curl"),
 ("Bulgarian Split Squat","legs","Quads & glutes","dumbbell","e1rm","per_dumbbell",False,120,60,49,"bss|split squat|rear foot elevated split squat|rfess"),
 ("Calf Raise","legs","Calves","selectorized","e1rm","stack",True,600,300,50,"calf raises|standing calf raise|calves"),
]
import re
def slug(n): return re.sub(r'[^a-z0-9]+','-',n.lower()).strip('-')
def q(s): return "'" + s.replace("'","''") + "'"
out=["-- SBLift 0006 — exercise catalog, machine manufacturers, achievement definitions.","-- Generated by scripts/catalog.py. Edit there and regenerate.",""]
out.append("insert into public.exercises (name, slug, category, muscle_group, equipment_type, ranking_method, weight_convention, supports_machine_selection, max_weight_kg, flag_threshold_kg, popular_rank) values")
rows=[]
for n,c,m,eq,meth,conv,mach,mx,fl,pop,al in E:
    rows.append(f"  ({q(n)}, {q(slug(n))}, {q(c)}, {q(m)}, {q(eq)}, {q(meth)}, {q(conv)}, {str(mach).lower()}, {mx if mx else 'null'}, {fl if fl else 'null'}, {pop})")
out.append(",\n".join(rows)+";")
out.append("")
out.append("insert into public.exercise_aliases (exercise_id, alias)\nselect e.id, a.alias from (values")
ar=[]
for n,*_,al in E:
    for a in al.split("|"):
        ar.append(f"  ({q(slug(n))}, {q(a)})")
out.append(",\n".join(ar))
out.append(") as a(slug, alias) join public.exercises e on e.slug = a.slug;")
out.append("")
out.append("insert into public.machine_manufacturers (name) values\n  " + ", ".join("(" + q(x) + ")" for x in ["Hammer Strength","Life Fitness","Matrix","Technogym","Cybex","Precor","Panatta","Atlantis","Rogue","Other"]) + ";")
out.append("")
ach=[("first_lift","First Lift","Submit your first lift.",1),("first_pr","First PR","Beat a previous personal record.",2),("top_three","Top Three","Reach the top three on a group board with at least 3 lifters.",3),("group_champion","Group Champion","Hold first place on a group board with at least 3 lifters.",4),("gym_champion","Gym Champion","Hold first place on a gym board.",5),("rival_overtaken","Rival Overtaken","Pass the person directly above you.",6),("verified_lifter","Verified Lifter","Get your first lift verified.",7),("five_records","Five Records","Hold five first-place rankings at once.",8)]
out.append("insert into public.achievements (id, name, description, sort_order) values\n" + ",\n".join(f"  ({q(a)}, {q(b)}, {q(c)}, {d})" for a,b,c,d in ach) + ";")
open("supabase/migrations/20261011000600_catalog.sql","w").write("\n".join(out)+"\n")
import json
json.dump([{"name":n,"slug":slug(n)} for n,*_ in E], open("/dev/null","w"))
print(len(E),"exercises", len(ar),"aliases")
