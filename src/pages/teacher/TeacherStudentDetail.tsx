import { useParams } from 'react-router-dom'
import { StudentDetailView } from '../shared/StudentDetailView'
import { useLiveData } from '../shared/useLiveData'
import { loadStudent } from './teacherData'

/** One linked student's record. The server refuses (403) any student who is not linked to this teacher. */
export default function TeacherStudentDetail() {
  const { id = '' } = useParams()
  const { data, error } = useLiveData(() => loadStudent(id), [id])
  return <StudentDetailView data={data} error={error} back={{ to: '/teacher', label: 'Back to My Students' }} />
}
