var SKIP_WAITLIST = true
var LASTNAME = 'Johnson'
var DELETE_EXISTING_CALENDAR = false 

function getCommunityPassEmails() {
  var communityPassEmails = GmailApp.search("\"transaction receipt for communitypass\"");
  for (var i in communityPassEmails) {
    var messages = communityPassEmails[i].getMessages();
    for (var j in messages) {
      var email = messages[j];
      try {
        handleCommunityPassEmail(email);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

function stripClassName(name) {
  return name.replace(/[^\w|&]/g, "")
}
function parseRegistration(registration) {
  // returns a dictionary containing name and class for the registration line. 
  var registration = registration.trim();
  if (registration.length < 20) return null;
  if (SKIP_WAITLIST && registration.includes('WAIT-LIST')) {
    return null;
  }

  const brRE = /<br \/>/g
  registration = registration.replace(brRE,' ');

  const regSplitter = String.raw`.*?Name:(?<name>.*?)Program:(?<program>.*?)Price`
  groups = registration.match(regSplitter).groups
  regDict = {'name':groups['name'].replace(LASTNAME,'').trim(), 'class': groups['program'].trim()};
  regDict['stripped_class_name'] = stripClassName(regDict['class']);

  return regDict
}

// Return dict of schedule info about one class
function parseClassBlock(classText) {
      const classSplitterRE = String.raw`.*?Class Schedule Information for "?(?<name>.*?)"?<br .>.*?Instructors:(?<instructor>.*?)<br .>(?<scheduleText>[0-9]\..*?)(?:={5,99}|$)`
      var classGroups = classText.match(classSplitterRE).groups;
      var classDict ={};
      classDict['name'] = classGroups['name'].trim();
      classDict['stripped_class_name'] = stripClassName(classDict['name']);
      classDict['instructor'] = classGroups['instructor'].trim();
      var occurances = classGroups['scheduleText'].split('<br />').filter(e => e) ;
      classDict['schedule'] = occurances;
      return classDict;

}
// returns array of all classes
function parseSchedule( scheduleText) { 
  var classDicts = [];
  var classBlocks = scheduleText.split("<br /><br />").filter(e => e)
  classBlocks.forEach((classBlock, index) => {
    var classDict = parseClassBlock(classBlock);
    if (classDict != null)
      classDicts.push(classDict);
  });

  return classDicts;
}
function handleCommunityPassEmail(email) {
  var registeredClasses = []
    emailText = email.getBody();
    const splitterRE = String.raw`={5,100}.{0,10}Notices.{0,10}={5,100}(?<notices>[\s\S]*?)={5,100}(?<schedule>[\s\S]*?)={5,100}<br \/>Registrations: Piedmont Recreation Programs<br \/>={5,100}(?<registrations>[\s\S]*?)={5,100}`
    var sections = emailText.match(splitterRE).groups;

    // use registrations section to get Student Name -> Class Name
    registrations = sections['registrations'].split('<br /><br />').filter(e => e) 
    for (i in registrations) {
      var registration = parseRegistration(registrations[i].trim());
      if (registration != null) registeredClasses.push(registration);
      
    }
    // parse out the class schedules and attach them to registrations
    var classes = parseSchedule(sections['schedule']);

   
    // iterate through the registrations and attach them to classes. Classes should be in order, but waitlisted classes are at the end, and have to attach multiple students. 
    registeredClasses.forEach((registeredClass, index) => {
      classes.forEach((classInfo, j) => {
        if ('full_stripped_class_name' in classInfo) {
          if (classInfo['full_stripped_class_name'] == registeredClass['stripped_class_name']) {
            classInfo['students'].push(registeredClass['name'])
          }
          return;

        };
        if (registeredClass['stripped_class_name'].includes(classInfo['stripped_class_name'])) {
          classInfo['class_name'] = registeredClass['class']
          classInfo['students'] = []
          classInfo['students'].push(registeredClass['name'])
          classInfo['full_stripped_class_name'] = registeredClass['stripped_class_name'];
          return;
        }
      });
      
    });

    var cals = CalendarApp.getCalendarsByName("CommunityPass");
    var cal;
    if (cals.length > 0) {
      if (DELETE_EXISTING_CALENDAR) cals[0].deleteCalendar()
      else cal = cals[0];
    } 
    if (cal == null) {
      cal = CalendarApp.createCalendar('CommunityPass', {summary: 'kids classes autoimported',color: CalendarApp.Color.PURPLE, timezone:'America/Los_Angeles'});
    }

    classes.forEach((classInfo, j) => {
      if (!('students' in classInfo)) {
        return;
      }
      const scheduleRE = String.raw`(?:[0-9]{1,2}\.)?(?<date>.*?202[2-9])(?<start>.*?M) \- (?<end>.*?M)(?<location>.*)`
      for (var i = 0; i < classInfo['schedule'].length; i++) {
        scheduleGroups = classInfo['schedule'][i].match(scheduleRE).groups
        var eventName = classInfo['class_name'];
        var startDate = new Date(Date.parse(scheduleGroups['date'] + " " + scheduleGroups['start']))
        var endDate = new Date(Date.parse(scheduleGroups['date'] + " " + scheduleGroups['end']))
        calEvents = cal.getEvents(startDate, endDate);
        var isNew = true;
        // don't add if event already exists
        for (var j = 0; j < calEvents.length; j++) {
          if (calEvents[j].getTitle() == eventName){
            isNew = false;
            continue;
          }
        }
        if (!isNew) {
          continue;
        }

  
        var event = cal.createEvent(eventName, startDate, endDate);
     
        event.setLocation(scheduleGroups['location']);
        event.setDescription(classInfo['students'] + " \n\n " + classInfo['class_name'])
      }
    });

    

}
