import re

MONTHS = {1:'January',2:'February',3:'March',4:'April',5:'May',6:'June',
          7:'July',8:'August',9:'September',10:'October',11:'November',12:'December'}

def to_full_date(d):
    day, mon, year = d.split('/')
    return f"{int(day)} {MONTHS[int(mon)]} {year}"

def to24h(t):
    m = re.match(r'(\d{1,2})-(\d{2})(am|pm)', t.strip(), re.I)
    h, mi, ap = int(m.group(1)), m.group(2), m.group(3).lower()
    if ap == 'pm' and h != 12:
        h += 12
    if ap == 'am' and h == 12:
        h = 0
    return f"{h:02d}:{mi}"

groups = {}

def add(comp, group, data):
    groups.setdefault((comp, group), [])
    for teamA, teamB, venue, date, time, rnd in data:
        groups[(comp, group)].append((teamA, teamB, to_full_date(date), to24h(time), venue, rnd))

add('Intermediate Football Championship', 'A', [
    ('Leixlip', 'Suncroft', 'Conneff Park Clane', '08/08/2026', '5-00pm', 'Round 1'),
    ('Confey', 'Straffan', "Cedral St Conleth's", '08/08/2026', '5-15pm', 'Round 1'),
    ('Confey', 'Leixlip', 'Conneff Park Clane', '22/08/2026', '3-30pm', 'Round 2'),
    ('Straffan', 'Suncroft', 'Manguard Park Pitch 2', '23/08/2026', '1-30pm', 'Round 2'),
    ('Confey', 'Suncroft', 'Manguard Park Pitch 1', '04/09/2026', '8-00pm', 'Round 3'),
    ('Leixlip', 'Straffan', 'Manguard Park Pitch 2', '04/09/2026', '8-00pm', 'Round 3'),
])
add('Intermediate Football Championship', 'B', [
    ('Kilcullen', 'Monasterevan', "Cedral St Conleth's", '08/08/2026', '3-30pm', 'Round 1'),
    ('Round Towers', "St. Laurence's", "Cedral St Conleth's", '09/08/2026', '3-45pm', 'Round 1'),
    ('Kilcullen', "St. Laurence's", 'Manguard Park Pitch 2', '22/08/2026', '5-00pm', 'Round 2'),
    ('Monasterevan', 'Round Towers', "Cedral St Conleth's", '23/08/2026', '2-00pm', 'Round 2'),
    ('Kilcullen', 'Round Towers', 'Raheens GAA', '05/09/2026', '6-00pm', 'Round 3'),
    ('Monasterevan', "St. Laurence's", 'Manguard Park Pitch 1', '05/09/2026', '6-00pm', 'Round 3'),
])
add('Intermediate Football Championship', 'C', [
    ('Ballyteague', 'Milltown', "Cedral St Conleth's", '07/08/2026', '7-45pm', 'Round 1'),
    ('Grangenolvin', 'Nurney', 'Manguard Park Pitch 1', '08/08/2026', '5-00pm', 'Round 1'),
    ('Ballyteague', 'Nurney', 'Manguard Park Pitch 2', '22/08/2026', '3-30pm', 'Round 2'),
    ('Grangenolvin', 'Milltown', 'Manguard Park Pitch 1', '23/08/2026', '6-00pm', 'Round 2'),
    ('Ballyteague', 'Grangenolvin', 'Kilcullen', '06/09/2026', '2-00pm', 'Round 3'),
    ('Milltown', 'Nurney', 'Manguard Park Pitch 2', '06/09/2026', '2-00pm', 'Round 3'),
])
add('Intermediate Football Championship', 'D', [
    ('Castledermot', 'Two Mile House', 'Manguard Park Pitch 1', '08/08/2026', '6-30pm', 'Round 1'),
    ('Ellistown', 'Rathangan', "Cedral St Conleth's", '09/08/2026', '2-00pm', 'Round 1'),
    ('Castledermot', 'Rathangan', 'Manguard Park Pitch 1', '23/08/2026', '3-00pm', 'Round 2'),
    ('Ellistown', 'Two Mile House', 'Manguard Park Pitch 2', '23/08/2026', '4-30pm', 'Round 2'),
    ('Ellistown', 'Castledermot', "St Laurence's", '06/09/2026', '3-30pm', 'Round 3'),
    ('Rathangan', 'Two Mile House', 'Round Towers GFC', '06/09/2026', '3-30pm', 'Round 3'),
])

add('Senior Football Championship', 'A', [
    ('Clane', 'Johnstownbridge', 'Manguard Park Pitch 1', '21/08/2026', '8-00pm', 'Round 1'),
    ('Allenwood', 'Celbridge', 'Conneff Park Clane', '22/08/2026', '5-00pm', 'Round 1'),
    ('Allenwood', 'Clane', "Cedral St Conleth's", '06/09/2026', '3-45pm', 'Round 2'),
    ('Celbridge', 'Johnstownbridge', 'Manguard Park Pitch 1', '06/09/2026', '5-00pm', 'Round 2'),
    ('Allenwood', 'Johnstownbridge', 'Manguard Park Pitch 1', '18/09/2026', '8-00pm', 'Round 3'),
    ('Celbridge', 'Clane', "Cedral St Conleth's", '18/09/2026', '8-00pm', 'Round 3'),
])
add('Senior Football Championship', 'B', [
    ('Carbury', 'Sarsfields', 'Manguard Park Pitch 1', '22/08/2026', '2-00pm', 'Round 1'),
    ('Caragh', 'Maynooth', "Cedral St Conleth's", '22/08/2026', '3-30pm', 'Round 1'),
    ('Caragh', 'Sarsfields', "Cedral St Conleth's", '04/09/2026', '7-45pm', 'Round 2'),
    ('Carbury', 'Maynooth', "Cedral St Conleth's", '05/09/2026', '5-15pm', 'Round 2'),
    ('Maynooth', 'Sarsfields', "Cedral St Conleth's", '19/09/2026', '3-00pm', 'Round 3'),
    ('Caragh', 'Carbury', 'Manguard Park Pitch 1', '19/09/2026', '3-00pm', 'Round 3'),
])
add('Senior Football Championship', 'C', [
    ('Raheens', 'Sallins', "Cedral St Conleth's", '22/08/2026', '5-00pm', 'Round 1'),
    ('Athy', 'Kilcock', "Cedral St Conleth's", '23/08/2026', '3-45pm', 'Round 1'),
    ('Athy', 'Sallins', "Cedral St Conleth's", '06/09/2026', '2-00pm', 'Round 2'),
    ('Kilcock', 'Raheens', 'Manguard Park Pitch 1', '06/09/2026', '3-30pm', 'Round 2'),
    ('Kilcock', 'Sallins', 'Manguard Park Pitch 1', '20/09/2026', '5-00pm', 'Round 3'),
    ('Athy', 'Raheens', "Cedral St Conleth's", '20/09/2026', '5-00pm', 'Round 3'),
])
add('Senior Football Championship', 'D', [
    ('Moorefield', 'Naas', "Cedral St Conleth's", '21/08/2026', '7-45pm', 'Round 1'),
    ('Clogherinkoe', 'Eadestown', 'Manguard Park Pitch 1', '22/08/2026', '6-30pm', 'Round 1'),
    ('Clogherinkoe', 'Moorefield', 'Manguard Park Pitch 1', '05/09/2026', '3-00pm', 'Round 2'),
    ('Eadestown', 'Naas', "Cedral St Conleth's", '05/09/2026', '3-30pm', 'Round 2'),
    ('Eadestown', 'Moorefield', "Cedral St Conleth's", '19/09/2026', '4-45pm', 'Round 3'),
    ('Clogherinkoe', 'Naas', 'Manguard Park Pitch 1', '19/09/2026', '4-45pm', 'Round 3'),
])

add('Junior Football Championship', 'A', [
    ('Robertstown', "St Kevin's", 'Conneff Park Clane', '08/08/2026', '3-30pm', 'Round 1'),
    ('Rathcoffey', 'Rheban', 'Manguard Park Pitch 1', '09/08/2026', '1-30pm', 'Round 1'),
    ('Rheban', "St Kevin's", 'Round Towers GFC', '22/08/2026', '5-00pm', 'Round 2'),
    ('Rathcoffey', 'Robertstown', 'Conneff Park Clane', '23/08/2026', '3-30pm', 'Round 2'),
    ('Rathcoffey', "St Kevin's", 'Conneff Park Clane', '05/09/2026', '4-30pm', 'Round 3'),
    ('Rheban', 'Robertstown', 'Manguard Park Pitch 2', '05/09/2026', '4-30pm', 'Round 3'),
])
add('Junior Football Championship', 'B', [
    ('Cappagh', 'Castlemitchell', 'Manguard Park Pitch 1', '08/08/2026', '3-30pm', 'Round 1'),
    ('Ballykelly', 'Kildangan', 'Manguard Park Pitch 1', '09/08/2026', '3-00pm', 'Round 1'),
    ('Ballykelly', 'Cappagh', 'Conneff Park Clane', '23/08/2026', '2-00pm', 'Round 2'),
    ('Castlemitchell', 'Kildangan', 'Kilcullen', '23/08/2026', '2-00pm', 'Round 2'),
    ('Ballykelly', 'Castlemitchell', 'Round Towers GFC', '05/09/2026', '3-00pm', 'Round 3'),
    ('Cappagh', 'Kildangan', 'Conneff Park Clane', '05/09/2026', '3-00pm', 'Round 3'),
])
add('Junior Football Championship', 'C', [
    ('Ardclough', 'Athgarvan', 'Manguard Park Pitch 1', '07/08/2026', '8-00pm', 'Round 1'),
    ('Ballymore Eustace', 'Kill', 'Manguard Park Pitch 1', '09/08/2026', '4-30pm', 'Round 1'),
    ('Ardclough', 'Ballymore Eustace', 'Manguard Park Pitch 2', '21/08/2026', '7-45pm', 'Round 2'),
    ('Athgarvan', 'Kill', 'Raheens GAA', '23/08/2026', '2-00pm', 'Round 2'),
    ('Athgarvan', 'Ballymore Eustace', 'Manguard Park Pitch 1', '03/09/2026', '8-00pm', 'Round 3'),
    ('Ardclough', 'Kill', 'Manguard Park Pitch 2', '03/09/2026', '8-00pm', 'Round 3'),
])

def esc(s):
    return s.replace("\\", "\\\\").replace("'", "\\'")

lines = []
for (comp, group), rows in groups.items():
    lines.append(f"// Kildare - {comp} Group {group}")
    lines.append("[")
    for teamA, teamB, date, time, venue, rnd in rows:
        lines.append(f" ['{esc(teamA)}','{esc(teamB)}','{date}','{time}','{esc(venue)}','{rnd}'],")
    lines.append(f"].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'{comp} Group {group}',r[5])));")
    lines.append("")

print("\n".join(lines))
